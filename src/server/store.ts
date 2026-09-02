import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type {
  ActivityEvent,
  AppStore,
  ContractorAgreement,
  ContractorCallApprovalInput,
  ContractorConfirmationInput,
  DemoMessageInput,
  InboundSmsInput,
  OutboundEffect,
  OutboundText,
  PhotoEvidenceContentType,
  ProposalInput,
  RepairCase,
  RepairMessage,
  Severity,
  TenantAccessAuthorizationInput,
  Trade,
  TriageInput,
} from "../shared/types.js";
import type { TwilioPhotoSource } from "./photo-evidence.js";
import { contractorSelection } from "./contractor-selection.js";
import {
  controlledLiveConfig,
  controlledLiveVoiceConfig,
  isControlledLiveMode,
  providerKey,
} from "./controlled-live.js";
import { createDemoStore, DEMO_CASE_ID, isDemoMode } from "./demo.js";
import { seedStore } from "./seed.js";

const storePath = () => {
  const fileName = isDemoMode()
    ? "demo-store.json"
    : isControlledLiveMode()
      ? "controlled-live-store.json"
      : "store.json";
  return resolve(
    process.cwd(),
    ".data",
    process.env.NODE_ENV === "test" || process.env.VITEST ? `test-${fileName}` : fileName,
  );
};

const controlledLiveAgreement = (): ContractorAgreement => ({
  id: "controlled-live-agreement",
  buildingId: "controlled-live-building",
  trade: "plumbing",
  contractorName: "Approved contractor",
  contractorPhone: "contractor",
  priority: 1,
  coveredWork: "Controlled-demo plumbing repairs",
  coveredSeverities: ["routine", "urgent", "emergency"],
  pricing: {
    basis: "fixed",
    amountPence: controlledLiveConfig().agreementPriceCents,
    currency: "USD",
    description: "Stored plumbing agreement price",
  },
  coverageHours: {
    description: "Controlled demo window",
    timeZone: "UTC",
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    startsAt: "00:00",
    endsAt: "23:59",
  },
  responseMinutes: { routine: 1440, urgent: 240, emergency: 60 },
  effectiveFrom: "2000-01-01T00:00:00.000Z",
  effectiveTo: "2100-01-01T00:00:00.000Z",
});

const cloneSeed = (resetAt = new Date()): AppStore =>
  isDemoMode()
    ? createDemoStore(resetAt)
    : isControlledLiveMode()
      ? {
          cases: [],
          contractorAgreements: [controlledLiveAgreement()],
          outbox: [],
          photoEvidenceJobs: [],
          controlledLive: {
            handledVoiceCallbacks: [],
            handledSmsEvents: [],
            retiredVoiceCallKeys: [],
          },
        }
      : structuredClone(seedStore);

const ensureStore = () => {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  try {
    readFileSync(path, "utf8");
  } catch {
    writeFileSync(path, JSON.stringify(cloneSeed(), null, 2));
  }
};

const readStore = (): AppStore => {
  ensureStore();
  const store = JSON.parse(readFileSync(storePath(), "utf8")) as AppStore;
  store.photoEvidenceJobs ??= [];
  if (isControlledLiveMode()) {
    store.controlledLive ??= {
      handledVoiceCallbacks: [],
      handledSmsEvents: [],
      retiredVoiceCallKeys: [],
    };
    store.controlledLive.handledSmsEvents ??= [];
    store.controlledLive.retiredVoiceCallKeys ??= [];
  }
  if (
    isControlledLiveMode() &&
    !store.contractorAgreements.some(({ id }) => id === "controlled-live-agreement")
  ) {
    store.contractorAgreements.push(controlledLiveAgreement());
  }
  return store;
};

const writeStore = (store: AppStore) => {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.next`;
  writeFileSync(temporaryPath, JSON.stringify(store, null, 2));
  renameSync(temporaryPath, path);
};

const now = () => new Date().toISOString();

const activity = (
  label: string,
  actor: ActivityEvent["actor"],
  detail?: string,
): ActivityEvent => ({
  id: randomUUID(),
  label,
  detail,
  actor,
  occurredAt: now(),
});

const message = (
  party: RepairMessage["party"],
  body: string,
  channel: RepairMessage["channel"],
  details: Pick<RepairMessage, "from" | "mediaId" | "photoEvidenceIds"> = {},
): RepairMessage => ({
  id: randomUUID(),
  party,
  body,
  channel,
  ...details,
  sentAt: now(),
});

const availabilityLabel = (value: string, timeZone = "UTC") =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(value));

const applyInboundMessage = (
  repair: RepairCase,
  input: {
    party: "tenant" | "contractor";
    from?: string;
    body: string;
    mediaId?: RepairMessage["mediaId"];
    activityLabel: string;
  },
) => {
  repair.messages.push(
    message(input.party, input.body, input.mediaId ? "mms" : "sms", {
      from: input.from,
      mediaId: input.mediaId,
    }),
  );
  repair.activity.push(activity(input.activityLabel, input.party, input.body));
};

const messageEvidenceForCurrentProposal = (
  repair: RepairCase,
  input: { sourceMessageId: string; proposalId: string; timeWindow: string },
  party: "tenant" | "contractor",
) => {
  if (!repair.proposal) throw new Error("There is no current contractor proposal.");
  const evidenceName = party === "tenant" ? "Tenant access" : "Contractor confirmation";
  if (
    repair.proposal.id !== input.proposalId ||
    (repair.proposal.timeWindow !== input.timeWindow &&
      (party === "contractor" || !isControlledLiveMode()))
  ) {
    throw new Error(`${evidenceName} must match the current proposal and visit window.`);
  }
  const sourceMessage = repair.messages.find((item) => item.id === input.sourceMessageId);
  if (sourceMessage?.party !== party) {
    throw new Error(`${evidenceName} requires a ${party} message from this repair.`);
  }
  const expectedFrom = party === "tenant" ? repair.tenant.phone : repair.proposal.contractorPhone;
  if (sourceMessage.from !== expectedFrom) {
    throw new Error(
      party === "tenant"
        ? "Tenant access requires a message from the current tenant."
        : "Contractor confirmation requires a message from the proposed contractor.",
    );
  }
  return { ...input, recordedAt: now() };
};

const matchesCurrentProposal = (
  evidence: { proposalId: string; timeWindow: string } | undefined,
  proposal: RepairCase["proposal"],
) =>
  Boolean(
    evidence &&
      proposal &&
      evidence.proposalId === proposal.id &&
      evidence.timeWindow === proposal.timeWindow,
  );

const isoInstantSchema = z.string().datetime({ offset: true });
const maxTranscriptEntryCharacters = 2_000;
const maxTranscriptEntries = 64;
const maxTranscriptCharacters = 64_000;

const timeWindowBounds = (value: string) => {
  const [start, end, extra] = value.split("/");
  if (
    extra ||
    !isoInstantSchema.safeParse(start).success ||
    !isoInstantSchema.safeParse(end).success
  ) {
    return undefined;
  }
  const startAt = Date.parse(start ?? "");
  const endAt = Date.parse(end ?? "");
  return startAt < endAt
    ? { startAt, endAt }
    : undefined;
};

const isInsideTimeWindow = (candidate: string, authority: string) => {
  const candidateBounds = timeWindowBounds(candidate);
  const authorityBounds = timeWindowBounds(authority);
  return Boolean(
    candidateBounds &&
      authorityBounds &&
      candidateBounds.startAt >= authorityBounds.startAt &&
      candidateBounds.endAt <= authorityBounds.endAt,
  );
};

const hasCurrentVoiceAuthority = (repair: RepairCase) => {
  const call = repair.voiceCall;
  const approval = repair.callApproval;
  const proposal = repair.proposal;
  return Boolean(
    call &&
      approval &&
      proposal &&
      !approval.revokedAt &&
      approval.id === call.approvalId &&
      approval.callsConsumed === 1 &&
      approval.proposalId === proposal.id &&
      approval.agreementId === proposal.agreementId &&
      approval.storedPrice.costPence === proposal.costPence &&
      approval.storedPrice.currency === proposal.currency &&
      approval.managerTimeWindow === proposal.timeWindow &&
      repair.approval?.proposalId === proposal.id &&
      repair.approval.timeWindow === proposal.timeWindow &&
      repair.tenantAccessAuthorization?.sourceMessageId ===
        approval.tenantAccess.sourceMessageId &&
      repair.tenantAccessAuthorization.timeWindow === approval.tenantAccess.timeWindow,
  );
};

const addManualContactTask = (
  repair: RepairCase,
  reason: string,
  approvalId = repair.voiceCall?.approvalId,
) => {
  if (!approvalId) return;
  const tasks = (repair.manualContactTasks ??= []);
  if (tasks.some((task) => task.approvalId === approvalId)) return;
  tasks.push({
    id: `manual:${approvalId}`,
    approvalId,
    reason,
    status: "open",
    createdAt: now(),
  });
  repair.activity.push(activity("Manual contractor follow-up required", "system", reason));
};

const surfaceUnknownEffect = (repair: RepairCase, effect: OutboundEffect) => {
  if (effect.type === "contractor_call") {
    addManualContactTask(
      repair,
      "Verify with the provider that no call was created before retrying the same approved call.",
      effect.approvalId,
    );
    repair.activity.push(activity("Contractor call start result is unknown", "system"));
  } else {
    if (effect.purpose === "booking_confirmation") {
      addManualContactTask(
        repair,
        "The tenant booking confirmation delivery result is unknown; verify it before resending.",
        repair.callApproval?.id,
      );
    }
    repair.activity.push(
      activity(
        effect.purpose === "booking_confirmation"
          ? "Tenant booking confirmation result is unknown"
          : "Tenant reply delivery result is unknown",
        "system",
        "Verify the provider result before recording delivery or retrying the saved text.",
      ),
    );
  }
};

const clearApprovalAndConfirmations = (repair: RepairCase) => {
  repair.approval = undefined;
  repair.callApproval = undefined;
  repair.tenantAccessAuthorization = undefined;
  repair.contractorConfirmation = undefined;
};

const invalidateCallApproval = (repair: RepairCase, detail: string) => {
  if (!repair.callApproval) {
    clearApprovalAndConfirmations(repair);
    return;
  }
  const approval = repair.callApproval;
  const state = repairAgentState(repair);
  const acceptedOrUncertain = state.effects.some(
    (effect) =>
      effect.type === "contractor_call" &&
      effect.approvalId === approval.id &&
      ["dispatching", "succeeded", "unknown"].includes(effect.status),
  );
  repair.approval = undefined;
  repair.contractorConfirmation = undefined;
  if (acceptedOrUncertain) {
    approval.revokedAt = now();
    approval.revokedReason = detail;
  } else {
    state.effects
      .filter(
        (effect) =>
          effect.type === "contractor_call" &&
          effect.approvalId === approval.id &&
          ["planned", "retryable"].includes(effect.status),
      )
      .forEach((effect) => {
        effect.status = "superseded";
        effect.updatedAt = now();
      });
    repair.callApproval = undefined;
  }
  if (repair.proposal) {
    repair.proposal.status = "proposed";
    repair.status = "waiting_for_approval";
  }
  repair.activity.push(activity("Call approval cleared", "system", detail));
};

const requireControlledLiveManagerReview = (repair: RepairCase) => {
  if (
    isControlledLiveMode() &&
    (repair.repairAgent?.phase !== "waiting_for_manager" ||
      (repair.severity !== "emergency" &&
        !repair.photoEvidence?.some(({ status }) => status === "available")))
  ) {
    throw new Error("An accepted tenant photo must be ready for property-manager review.");
  }
};

const repairAgentState = (repair: RepairCase) => {
  const state = (repair.repairAgent ??= {
    revision: 0,
    nextSequence: 1,
    phase: "idle",
    tenantMessaging: "active",
    events: [],
    runs: [],
    effects: [],
  });
  state.tenantMessaging ??= "active";
  return state;
};

const finishRun = (
  repair: RepairCase,
  status: "completed" | "failed" | "superseded" | "interrupted",
  error?: string,
) => {
  const state = repairAgentState(repair);
  const run = state.activeRun;
  if (!run) return;
  run.status = status;
  run.finishedAt = now();
  run.error = error;
  state.runs.push(run);
  state.activeRun = undefined;
};

export const appointmentNotification = (repair: RepairCase) => ({
  to: repair.tenant.phone,
  body: `Your repair visit is booked with ${repair.appointment?.contractorName} for ${repair.appointment?.timeWindow}.`,
});

const outboxMessage = (
  to: string,
  body: string,
  delivery: OutboundText["delivery"],
  caseId?: string,
): OutboundText => ({ id: randomUUID(), caseId, to, body, sentAt: now(), delivery });

const completeTenantTextEffect = (
  repair: RepairCase,
  store: AppStore,
  effect: Extract<OutboundEffect, { type: "tenant_sms" }>,
  result: { delivery: OutboundText["delivery"]; providerId?: string },
  reconciled = false,
) => {
  effect.status = "succeeded";
  effect.delivery = result.delivery;
  if (result.providerId) {
    effect.providerId = `…${result.providerId.slice(-6)}`;
    effect.providerKey = providerKey(result.providerId);
  }
  effect.updatedAt = now();
  repair.messages.push(message("agent", effect.body, "sms"));
  const outbound = outboxMessage("tenant", effect.body, result.delivery, repair.id);
  repair.activity.push(
    activity(
      `${effect.purpose === "booking_confirmation" ? "Tenant booking confirmation" : "Tenant reply"} ${reconciled ? "verified as " : ""}accepted by provider`,
      reconciled ? "manager" : "agent",
      effect.body,
    ),
  );
  store.outbox.push(outbound);
  if (effect.purpose === "booking_confirmation") {
    if (repair.appointment) repair.appointment.notificationId = outbound.id;
    repair.notifications = [outbound];
  }
};

const completeContractorCallEffect = (
  repair: RepairCase,
  effect: Extract<OutboundEffect, { type: "contractor_call" }>,
  providerId: string,
) => {
  if (
    !repair.callApproval ||
    repair.callApproval.id !== effect.approvalId ||
    repair.callApproval.callsConsumed !== 0
  ) {
    effect.status = "superseded";
    effect.updatedAt = now();
    return;
  }
  effect.status = "succeeded";
  effect.providerId = `…${providerId.slice(-6)}`;
  effect.providerKey = providerKey(providerId);
  effect.updatedAt = now();
  repair.manualContactTasks = repair.manualContactTasks?.filter(
    ({ approvalId }) => approvalId !== effect.approvalId,
  );
  repair.callApproval.callsConsumed = 1;
  repair.voiceCall = {
    effectKey: effect.effectKey,
    approvalId: effect.approvalId,
    providerId: effect.providerId,
    providerKey: effect.providerKey,
    enrollmentConsentAt: controlledLiveVoiceConfig().enrollmentConsentAt,
    disclosureServed: false,
    perCallConsent: "not_requested",
    sipBridgeOffered: false,
    openAiConnected: false,
    openAiConnectionStatus: "not_requested",
    transportStatus: "queued",
    transcript: [],
    handledCallbacks: [],
  };
  repair.activity.push(
    activity(
      "Provider accepted one approved contractor call",
      "system",
      "The one-call authority is consumed; fixed disclosure and keypad consent must run before AI audio.",
    ),
  );
};

const applyVoiceTransport = (
  repair: RepairCase,
  eventKey: string,
  status: NonNullable<RepairCase["voiceCall"]>["transportStatus"],
  sequence?: number,
) => {
  const call = repair.voiceCall;
  if (!call) throw new Error("Voice status did not match an approved call.");
  const duplicate = call.handledCallbacks.includes(eventKey);
  if (duplicate) return true;
  call.handledCallbacks.push(eventKey);
  if (sequence === undefined || call.transportSequence === undefined || sequence > call.transportSequence) {
    call.transportStatus = status;
    call.transportSequence = sequence;
    if (!call.outcome && ["busy", "no-answer", "canceled"].includes(status)) {
      call.outcome = "unreachable";
      addManualContactTask(repair, `The contractor call was ${status}.`);
    } else if (!call.outcome && status === "failed") {
      call.outcome = "failed";
      addManualContactTask(repair, "Twilio reported that the contractor call failed.");
    } else if (!call.outcome && status === "completed") {
      const postConsent = call.perCallConsent === "granted";
      call.outcome = postConsent ? "needs_manual_follow_up" : "no_consent_response";
      call.outcomeProvisional = true;
      call.outcomeSummary = postConsent
        ? "The consented call completed without a contractor outcome."
        : "The call completed before a keypad consent result was recorded.";
      addManualContactTask(repair, call.outcomeSummary);
    }
    repair.activity.push(activity("Contractor call status changed", "system", status));
  }
  return false;
};

const mutateCase = (caseId: string, mutate: (repair: RepairCase, store: AppStore) => void) => {
  const store = readStore();
  const repair = store.cases.find((item) => item.id === caseId);
  if (!repair) throw new Error("Repair case not found.");
  mutate(repair, store);
  repair.updatedAt = now();
  writeStore(store);
  return repair;
};

export const repairStore = {
  list() {
    return readStore().cases.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  get(caseId: string) {
    const repair = readStore().cases.find((item) => item.id === caseId);
    if (!repair) throw new Error("Repair case not found.");
    return repair;
  },

  photoEvidence(caseId: string, evidenceId: string) {
    const store = readStore();
    const repair = store.cases.find((item) => item.id === caseId);
    const evidence = repair?.photoEvidence?.find((item) => item.id === evidenceId);
    const job = store.photoEvidenceJobs?.find(
      (item) => item.caseId === caseId && item.id === evidenceId,
    );
    if (
      evidence?.status !== "available" ||
      job?.status !== "available" ||
      !job.contentType ||
      !job.dataBase64
    ) {
      throw new Error("Photo evidence not found.");
    }
    return { contentType: job.contentType, bytes: Buffer.from(job.dataBase64, "base64") };
  },

  contractorPath(caseId: string) {
    const store = readStore();
    const repair = store.cases.find((item) => item.id === caseId);
    if (!repair) throw new Error("Repair case not found.");
    return contractorSelection.assess({
      repair,
      agreements: store.contractorAgreements,
      now: new Date(),
      requiredBy: repair.requiredBy,
    });
  },

  proposePreferred(
    caseId: string,
    input: { agreementId: string; timeWindow: string; reason: string },
  ) {
    const store = readStore();
    const repair = store.cases.find((item) => item.id === caseId);
    if (!repair) throw new Error("Repair case not found.");
    if (repair.status === "scheduled" || repair.status === "closed" || repair.appointment) {
      throw new Error("A proposal cannot be added to a finished repair.");
    }
    if (isControlledLiveMode() && !timeWindowBounds(input.timeWindow)) {
      throw new Error("Use an ISO 8601 start/end time window.");
    }
    requireControlledLiveManagerReview(repair);
    const decision = contractorSelection.assess({
      repair,
      agreements: store.contractorAgreements,
      now: new Date(),
      requiredBy: repair.requiredBy,
    });
    if (decision.kind !== "preferred_available" || decision.agreementId !== input.agreementId) {
      throw new Error("Use the next eligible approved contractor for this repair.");
    }
    const agreement = store.contractorAgreements.find((item) => item.id === input.agreementId);
    if (!agreement) throw new Error("Approved contractor agreement not found for this repair.");

    return mutateCase(caseId, (selectedRepair) => {
      invalidateCallApproval(
        selectedRepair,
        "The property manager changed the contractor proposal.",
      );
      selectedRepair.tenantAccessAuthorization = undefined;
      selectedRepair.proposal = {
        id: randomUUID(),
        contractorName: agreement.contractorName,
        contractorPhone: agreement.contractorPhone,
        timeWindow: input.timeWindow,
        costPence: agreement.pricing.amountPence,
        currency: agreement.pricing.currency,
        reason: input.reason,
        source: "agreement",
        agreementId: agreement.id,
        priceBasis: agreement.pricing.description,
        status: "proposed",
      };
      selectedRepair.status = "waiting_for_approval";
      selectedRepair.activity.push(
        activity(
          "Approved agreement option prepared",
          "agent",
          `${agreement.contractorName}; proposed manager window ${input.timeWindow}`,
        ),
        activity("Waiting for your approval", "system"),
      );
    });
  },

  recordContractorUnavailable(
    caseId: string,
    input: { agreementId: string; reason: string; earliestAvailableAt: string },
  ) {
    const store = readStore();
    const repair = store.cases.find((item) => item.id === caseId);
    if (!repair) throw new Error("Repair case not found.");
    const update = contractorSelection.recordUnavailable({
      repair,
      agreements: store.contractorAgreements,
      ...input,
      now: new Date(),
      requiredBy: repair.requiredBy,
    });
    const updatedRepair = mutateCase(caseId, (selectedRepair) => {
      selectedRepair.contractorAttempts.push(update.attempt);
      if (selectedRepair.proposal?.agreementId === input.agreementId) {
        selectedRepair.proposal = undefined;
        clearApprovalAndConfirmations(selectedRepair);
        selectedRepair.status = "new";
      }
      selectedRepair.activity.push(
        activity(
          `${update.attempt.contractorName} is unavailable`,
          "contractor",
          `${update.attempt.reason} Earliest availability: ${availabilityLabel(
            update.attempt.earliestAvailableAt,
            repair.demoFixture?.organization.timeZone,
          )}.`,
        ),
      );
    });
    return { repair: updatedRepair, decision: update.decision };
  },

  startExternalSearch(
    caseId: string,
    input: { requiredBy?: string },
  ) {
    const store = readStore();
    const repair = store.cases.find((item) => item.id === caseId);
    if (!repair) throw new Error("Repair case not found.");
    const managerRequest = repair.externalSearchRequest;
    const requiredBy = repair.severity === "routine" && managerRequest
      ? managerRequest.requiredBy
      : repair.requiredBy ?? input.requiredBy;
    if (!requiredBy) {
      throw new Error("Urgent and emergency external search needs a response deadline.");
    }
    const authorization = contractorSelection.startExternalSearch({
      repair,
      agreements: store.contractorAgreements,
      requiredBy,
      requestedByManager: managerRequest?.requestedBy,
      now: new Date(),
    });
    const updatedRepair = mutateCase(caseId, (selectedRepair) => {
      selectedRepair.externalSearch = authorization;
      selectedRepair.activity.push(
        activity("External contractor search started", "agent", authorization.reason),
      );
    });
    return { repair: updatedRepair, authorization };
  },

  requestExternalSearch(
    caseId: string,
    input: { requestedBy: string; requiredBy: string },
  ) {
    return mutateCase(caseId, (repair) => {
      repair.externalSearchRequest = {
        requestedBy: input.requestedBy,
        requestedAt: now(),
        requiredBy: input.requiredBy,
      };
      repair.activity.push(
        activity(
          `${input.requestedBy} requested external contractor options`,
          "manager",
          `Options required by ${availabilityLabel(
            input.requiredBy,
            repair.demoFixture?.organization.timeZone,
          )}.`,
        ),
      );
    });
  },

  receiveSms(input: InboundSmsInput) {
    const store = readStore();
    const existing = store.cases.find(
      (item) => item.tenant.phone === input.from && item.status !== "closed",
    );

    if (existing) {
      applyInboundMessage(existing, {
        party: "tenant",
        from: input.from,
        body: input.body,
        activityLabel: `${existing.tenant.name} sent a text`,
      });
      existing.updatedAt = now();
      writeStore(store);
      return existing;
    }

    const createdAt = now();
    const tenantName = input.tenantName?.trim() || "New tenant";
    const unit = input.unit?.trim() || "Unit not provided";
    const repair: RepairCase = {
      id: randomUUID(),
      buildingId: "18-hawthorn-court",
      title: "New repair message",
      summary: input.body,
      severity: "routine",
      trade: "general",
      status: "new",
      tenant: { name: tenantName, unit, phone: input.from },
      createdAt,
      updatedAt: createdAt,
      messages: [],
      activity: [],
      contractorAttempts: [],
    };
    applyInboundMessage(repair, {
      party: "tenant",
      from: input.from,
      body: input.body,
      activityLabel: `${tenantName} reported a repair`,
    });
    store.cases.push(repair);
    writeStore(store);
    return repair;
  },

  receiveVerifiedSms(input: {
    sourceKey: string;
    body: string;
    preference?: "STOP" | "START" | "HELP";
    photos?: TwilioPhotoSource[];
  }) {
    if (!isControlledLiveMode()) {
      throw new Error("Verified SMS wake events require CONTROLLED_LIVE_MODE.");
    }
    const store = readStore();
    const duplicate = store.cases.find((repair) =>
      repair.repairAgent?.events.some((event) => event.sourceKey === input.sourceKey),
    );
    if (duplicate) return { repair: duplicate, duplicate: true };
    if (store.controlledLive?.handledSmsEvents.includes(input.sourceKey)) {
      throw new Error("SMS event was already handled before controlled reset.");
    }

    let repair = store.cases.find((item) => item.id === "controlled-live-repair");
    if (!repair) {
      const createdAt = now();
      repair = {
        id: "controlled-live-repair",
        buildingId: "controlled-live-building",
        title: "New repair text",
        summary: input.body,
        severity: "routine",
        trade: "general",
        status: "new",
        tenant: { name: "Tenant", unit: "Controlled demo unit", phone: "tenant" },
        createdAt,
        updatedAt: createdAt,
        messages: [],
        activity: [],
        contractorAttempts: [],
      };
      store.cases.push(repair);
    }

    const state = repairAgentState(repair);
    if (store.controlledLive?.tenantMessagingStoppedAt && input.preference !== "START") {
      state.tenantMessaging = "stopped";
      state.phase = "stopped";
    }
    const booked = Boolean(repair.appointment);
    const photoEvidenceIds = booked ? [] : input.photos?.map(() => randomUUID()) ?? [];
    const tenantMessage = message(
      "tenant",
      input.body,
      photoEvidenceIds.length ? "mms" : "sms",
      { from: "tenant", ...(photoEvidenceIds.length ? { photoEvidenceIds } : {}) },
    );
    repair.messages.push(tenantMessage);
    if (!booked && input.photos?.length) {
      repair.photoEvidence ??= [];
      store.photoEvidenceJobs ??= [];
      input.photos.forEach((photo, index) => {
        const id = photoEvidenceIds[index]!;
        const receivedAt = now();
        repair!.photoEvidence!.push({
          id,
          messageId: tenantMessage.id,
          status: "pending",
          receivedAt,
        });
        store.photoEvidenceJobs!.push({
          id,
          caseId: repair!.id,
          messageId: tenantMessage.id,
          sourceUrl: photo.sourceUrl,
          sourceMessageSid: photo.messageSid,
          expectedContentType: photo.expectedContentType,
          status: "pending",
          receivedAt,
          updatedAt: receivedAt,
        });
      });
    }
    if (input.preference === "STOP") {
      state.tenantMessaging = "stopped";
      state.phase = "stopped";
      if (store.controlledLive) store.controlledLive.tenantMessagingStoppedAt = now();
      state.events
        .filter((event) => event.status === "pending" || event.status === "claimed")
        .forEach((event) => (event.status = "handled"));
      state.effects
        .filter((effect) => effect.status === "planned" || effect.status === "retryable")
        .forEach((effect) => {
          effect.status = "superseded";
          effect.updatedAt = now();
        });
      store.photoEvidenceJobs
        ?.filter(
          (job) =>
            job.caseId === repair!.id &&
            ["pending", "fetching", "retryable"].includes(job.status),
        )
        .forEach((job) => {
          job.status = "superseded";
          job.updatedAt = now();
        });
    } else if (input.preference === "START") {
      state.tenantMessaging = "active";
      state.phase = "idle";
      if (store.controlledLive) delete store.controlledLive.tenantMessagingStoppedAt;
    }
    const shouldWake = !booked && !input.preference && state.tenantMessaging === "active";
    const activityLabel =
      input.preference === "STOP"
        ? "Tenant stopped automated texts"
        : input.preference === "START"
          ? "Tenant restarted automated texts"
          : input.preference === "HELP"
            ? "Tenant requested messaging help"
            : shouldWake
              ? photoEvidenceIds.length
                ? "Tenant sent a verified MMS"
                : "Tenant sent a verified text"
              : booked
                ? "Tenant text received after booking"
                : "Tenant text received while automated replies are stopped";
    repair.activity.push(activity(activityLabel, "tenant", input.body));
    if (input.preference !== "HELP" && !booked) {
      invalidateCallApproval(repair, "The tenant sent a new case update.");
    }
    if (input.preference === "STOP") {
      repair.activity.push(
        activity("Manual contact required", "system", "Automated tenant messaging is stopped."),
      );
    }
    state.events.push({
      id: randomUUID(),
      sourceKey: input.sourceKey,
      sequence: state.nextSequence,
      messageId: tenantMessage.id,
      status: shouldWake ? "pending" : "handled",
      receivedAt: now(),
    });
    store.controlledLive?.handledSmsEvents.push(input.sourceKey);
    state.nextSequence += 1;
    if (input.preference !== "HELP") state.revision += 1;
    if (shouldWake) state.phase = "pending";
    repair.updatedAt = now();
    writeStore(store);
    return { repair, duplicate: false, shouldWake };
  },

  claimPhotoEvidenceJob(caseId: string) {
    const store = readStore();
    const repair = store.cases.find((item) => item.id === caseId);
    if (!repair) throw new Error("Repair case not found.");
    if (repairAgentState(repair).tenantMessaging === "stopped") return undefined;
    const job = store.photoEvidenceJobs?.find(
      (item) =>
        item.caseId === caseId && (item.status === "pending" || item.status === "retryable"),
    );
    if (!job) return undefined;
    job.status = "fetching";
    job.updatedAt = now();
    writeStore(store);
    return {
      jobId: job.id,
      sourceUrl: job.sourceUrl,
      messageSid: job.sourceMessageSid,
      expectedContentType: job.expectedContentType,
    };
  },

  completePhotoEvidenceJob(
    caseId: string,
    jobId: string,
    result: { contentType: PhotoEvidenceContentType; dataBase64: string },
  ) {
    const store = readStore();
    const repair = store.cases.find((item) => item.id === caseId);
    if (!repair) throw new Error("Repair case not found.");
    const job = store.photoEvidenceJobs?.find(
      (item) => item.id === jobId && item.caseId === caseId,
    );
    if (!job || job.status !== "fetching") return false;
    const evidence = repair.photoEvidence?.find((item) => item.id === jobId);
    if (!evidence) throw new Error("Photo evidence record not found.");
    const bytes = Buffer.from(result.dataBase64, "base64");
    const totalBytes =
      (store.photoEvidenceJobs ?? [])
        .filter(
          (item) =>
            item.caseId === caseId &&
            item.messageId === job.messageId &&
            item.status === "available",
        )
        .reduce((total, item) => total + (item.byteLength ?? 0), 0) + bytes.byteLength;
    const available = totalBytes <= 5 * 1024 * 1024;
    if (!available) {
      job.status = "rejected";
      evidence.status = "rejected";
      evidence.rejectionReason = "The MMS photos exceed the 5 MB message limit.";
    } else {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      Object.assign(job, {
        status: "available" as const,
        contentType: result.contentType,
        dataBase64: result.dataBase64,
        byteLength: bytes.byteLength,
        sha256,
      });
      Object.assign(evidence, {
        status: "available" as const,
        contentType: result.contentType,
        byteLength: bytes.byteLength,
        sha256,
      });
      repair.activity.push(
        activity("Tenant photo file accepted", "system", result.contentType),
      );
    }
    job.updatedAt = now();
    repair.updatedAt = now();
    writeStore(store);
    return available;
  },

  failPhotoEvidenceJob(caseId: string, jobId: string, retryable: boolean, reason: string) {
    const store = readStore();
    const repair = store.cases.find((item) => item.id === caseId);
    if (!repair) throw new Error("Repair case not found.");
    const job = store.photoEvidenceJobs?.find(
      (item) => item.id === jobId && item.caseId === caseId,
    );
    if (!job || job.status !== "fetching") return false;
    job.status = retryable ? "retryable" : "rejected";
    job.updatedAt = now();
    if (!retryable) {
      const evidence = repair.photoEvidence?.find((item) => item.id === jobId);
      if (evidence) {
        evidence.status = "rejected";
        evidence.rejectionReason = reason;
      }
      repair.activity.push(activity("Tenant photo evidence rejected", "system", reason));
    }
    repair.updatedAt = now();
    writeStore(store);
    return true;
  },

  startAgentRun(caseId: string) {
    const store = readStore();
    const repair = store.cases.find((item) => item.id === caseId);
    if (!repair) throw new Error("Repair case not found.");
    const state = repairAgentState(repair);
    if (state.tenantMessaging === "stopped") return undefined;
    if (state.activeRun) return undefined;
    const pending = state.events.filter((event) => event.status === "pending");
    if (!pending.length) return undefined;
    const highWater = Math.max(...pending.map((event) => event.sequence));
    pending
      .filter((event) => event.sequence <= highWater)
      .forEach((event) => (event.status = "claimed"));
    const run = {
      id: randomUUID(),
      status: "active" as const,
      snapshotRevision: state.revision,
      highWater,
      startedAt: now(),
    };
    state.activeRun = run;
    state.phase = "working";
    writeStore(store);
    return {
      runId: run.id,
      caseId: repair.id,
      messages: repair.messages.map(({ party, body }) => ({ party, body })),
      photos: (store.photoEvidenceJobs ?? [])
        .filter(
          (job) =>
            job.caseId === caseId &&
            job.status === "available" &&
            job.contentType &&
            job.dataBase64,
        )
        .map(({ contentType, dataBase64 }) => ({
          contentType: contentType!,
          dataBase64: dataBase64!,
        })),
    };
  },

  commitAgentDecision(
    caseId: string,
    runId: string,
    input: {
      nextStep: "ask_tenant" | "manager_review";
      title: string;
      summary: string;
      severity: Severity;
      trade: Trade;
      tenantReply: string;
      managerReason: string;
    },
  ) {
    const store = readStore();
    const repair = store.cases.find((item) => item.id === caseId);
    if (!repair) throw new Error("Repair case not found.");
    const state = repairAgentState(repair);
    const run = state.activeRun;
    if (!run || run.id !== runId) return false;
    if (state.revision !== run.snapshotRevision) {
      state.events
        .filter((event) => event.status === "claimed" && event.sequence <= run.highWater)
        .forEach((event) => (event.status = "pending"));
      finishRun(repair, "superseded");
      state.phase =
        state.tenantMessaging === "stopped"
          ? "stopped"
          : state.events.some((event) => event.status === "pending")
            ? "pending"
            : "idle";
      writeStore(store);
      return false;
    }

    repair.title = input.title;
    repair.summary = input.summary;
    repair.severity = input.severity;
    repair.trade = input.trade;
    invalidateCallApproval(repair, "The repair agent changed the reviewed case facts.");
    const needsPhoto =
      input.severity !== "emergency" &&
      !repair.photoEvidence?.some(({ status }) => status === "available");
    const waitingForTenant = needsPhoto || input.nextStep === "ask_tenant";
    const photoRequest =
      "Please reply with a clear photo of the problem and surrounding area, if it is safe.";
    const tenantReply = needsPhoto
      ? input.nextStep === "ask_tenant"
        ? `${photoRequest} ${input.tenantReply}`
        : `${photoRequest} You can include any other details in the same case.`
      : input.tenantReply;
    state.events
      .filter((event) => event.status === "claimed" && event.sequence <= run.highWater)
      .forEach((event) => (event.status = "handled"));
    const effectKey = `sms:tenant:${needsPhoto ? "photo-request" : input.nextStep}:through-${run.highWater}`;
    if (!state.effects.some((effect) => effect.effectKey === effectKey)) {
      const createdAt = now();
      state.effects
        .filter((effect) => effect.status === "planned" || effect.status === "retryable")
        .forEach((effect) => {
          effect.status = "superseded";
          effect.updatedAt = createdAt;
        });
      state.effects.push({
        effectKey,
        type: "tenant_sms",
        target: "tenant",
        body: tenantReply,
        status: "planned",
        attempts: 0,
        createdAt,
        updatedAt: createdAt,
      });
    }
    finishRun(repair, "completed");
    state.phase = waitingForTenant ? "waiting_for_tenant" : "waiting_for_manager";
    state.revision += 1;
    repair.activity.push(activity("Agent reviewed the repair", "agent", input.summary));
    repair.activity.push(
      needsPhoto
        ? activity(
            "Waiting for tenant photo evidence",
            "system",
            "A validated photo is required before property-manager review.",
          )
        : input.nextStep === "ask_tenant"
          ? activity("Waiting for tenant reply", "system", input.tenantReply)
          : activity("Waiting for property manager", "system", input.managerReason),
    );
    repair.updatedAt = now();
    writeStore(store);
    return true;
  },

  failAgentRun(caseId: string, runId: string, error: string) {
    return mutateCase(caseId, (repair) => {
      const state = repairAgentState(repair);
      const run = state.activeRun;
      if (!run || run.id !== runId) return;
      state.events
        .filter((event) => event.status === "claimed" && event.sequence <= run.highWater)
        .forEach((event) => (event.status = "pending"));
      finishRun(repair, "failed", error);
      state.phase =
        state.tenantMessaging === "stopped"
          ? "stopped"
          : state.events.some((event) => event.status === "pending")
            ? "pending"
            : "idle";
      repair.activity.push(activity("Repair agent stopped safely", "system"));
    });
  },

  claimAgentEffect(caseId: string) {
    const store = readStore();
    const repair = store.cases.find((item) => item.id === caseId);
    if (!repair) throw new Error("Repair case not found.");
    const state = repairAgentState(repair);
    if (state.tenantMessaging === "stopped") return undefined;
    const effect = state.effects.find(
      (item) => item.status === "planned" || item.status === "retryable",
    );
    if (!effect) return undefined;
    effect.status = "dispatching";
    effect.attempts += 1;
    effect.updatedAt = now();
    writeStore(store);
    return structuredClone(effect);
  },

  completeAgentEffect(
    caseId: string,
    effectKey: string,
    result: { delivery: OutboundText["delivery"]; providerId: string },
  ) {
    return mutateCase(caseId, (repair, store) => {
      const effect = repairAgentState(repair).effects.find(
        (item) => item.effectKey === effectKey,
      );
      if (
        !effect ||
        effect.type !== "tenant_sms" ||
        !["dispatching", "unknown"].includes(effect.status)
      ) return;
      completeTenantTextEffect(repair, store, effect, result);
    });
  },

  completeContractorCallEffect(caseId: string, effectKey: string, providerId: string) {
    return mutateCase(caseId, (repair) => {
      const effect = repairAgentState(repair).effects.find(
        (item) => item.effectKey === effectKey,
      );
      if (
        !effect ||
        effect.type !== "contractor_call" ||
        !["dispatching", "unknown"].includes(effect.status)
      ) {
        return;
      }
      completeContractorCallEffect(repair, effect, providerId);
    });
  },

  bindVoiceCallback(approvalId: string, providerId: string) {
    const store = readStore();
    const repair = store.cases.find(
      (item) => item.callApproval?.id === approvalId || item.voiceCall?.approvalId === approvalId,
    );
    if (!repair) throw new Error("Voice callback did not match an approved call.");
    if (repair.voiceCall) {
      if (repair.voiceCall.providerKey !== providerKey(providerId)) {
        throw new Error("Voice callback did not match the approved provider call.");
      }
      return repair;
    }
    const effect = repair.repairAgent?.effects.find(
      (item) =>
        item.type === "contractor_call" &&
        item.approvalId === approvalId &&
        ["dispatching", "unknown"].includes(item.status),
    );
    if (!effect) throw new Error("Voice callback did not match a dispatched call.");
    repairStore.completeContractorCallEffect(repair.id, effect.effectKey, providerId);
    return repairStore.get(repair.id);
  },

  wasSmsEventHandled(eventKey: string) {
    return Boolean(readStore().controlledLive?.handledSmsEvents.includes(eventKey));
  },

  wasVoiceCallbackHandled(eventKey: string) {
    return Boolean(readStore().controlledLive?.handledVoiceCallbacks.includes(eventKey));
  },

  wasVoiceCallRetired(providerId: string) {
    return Boolean(
      readStore().controlledLive?.retiredVoiceCallKeys.includes(providerKey(providerId)),
    );
  },

  recordVoiceDisclosure(providerId: string, eventKey: string) {
    const store = readStore();
    const repair = store.cases.find(
      (item) => item.voiceCall?.providerKey === providerKey(providerId),
    );
    if (!repair?.voiceCall) throw new Error("Voice callback did not match an approved call.");
    const call = repair.voiceCall;
    const duplicate = call.handledCallbacks.includes(eventKey);
    if (!duplicate) {
      call.handledCallbacks.push(eventKey);
      call.disclosureServed = true;
      call.perCallConsent = "pending";
      repair.activity.push(
        activity(
          "Fixed AI disclosure served",
          "system",
          "OpenAI remains disconnected while the contractor chooses Press 1 or Press 2.",
        ),
      );
      repair.updatedAt = now();
      writeStore(store);
    }
    return { repair, duplicate };
  },

  recordVoiceConsent(
    providerId: string,
    eventKey: string,
    consent: "granted" | "declined" | "timed_out",
  ) {
    const store = readStore();
    const repair = store.cases.find(
      (item) => item.voiceCall?.providerKey === providerKey(providerId),
    );
    if (!repair?.voiceCall) throw new Error("Voice callback did not match an approved call.");
    const call = repair.voiceCall;
    const duplicate = call.handledCallbacks.includes(eventKey);
    if (!duplicate) {
      if (!call.disclosureServed || call.perCallConsent !== "pending") {
        throw new Error("Voice consent arrived before the fixed disclosure.");
      }
      call.handledCallbacks.push(eventKey);
      call.perCallConsent = consent;
      if (consent === "granted") call.consentAt = now();
      else {
        if (call.outcomeProvisional) {
          repair.manualContactTasks = repair.manualContactTasks?.filter(
            ({ approvalId }) => approvalId !== call.approvalId,
          );
          call.outcomeProvisional = undefined;
        }
        call.outcome = consent === "declined" ? "consent_declined" : "no_consent_response";
        addManualContactTask(
          repair,
          consent === "declined"
            ? "The contractor declined AI processing."
            : "The contractor did not provide per-call keypad consent.",
        );
      }
      repair.activity.push(
        activity(
          consent === "granted" ? "Per-call keypad consent recorded" : "Voice consent not obtained",
          "contractor",
          consent === "granted" ? "Press 1" : consent === "declined" ? "Press 2" : "No response",
        ),
      );
      repair.updatedAt = now();
      writeStore(store);
    }
    return { repair, duplicate };
  },

  claimVoiceSipBridge(providerId: string) {
    const store = readStore();
    const repair = store.cases.find(
      (item) => item.voiceCall?.providerKey === providerKey(providerId),
    );
    if (!repair?.voiceCall) throw new Error("Voice bridge did not match an approved call.");
    const call = repair.voiceCall;
    if (
      call.perCallConsent !== "granted" ||
      !call.consentAt ||
      (call.outcome && !call.outcomeProvisional) ||
      !hasCurrentVoiceAuthority(repair)
    ) {
      return false;
    }
    if (!call.sipBridgeOffered) {
      call.sipBridgeOffered = true;
      repair.updatedAt = now();
      writeStore(store);
    }
    return true;
  },

  recordVoiceTransport(
    providerId: string,
    eventKey: string,
    status: NonNullable<RepairCase["voiceCall"]>["transportStatus"],
    sequence?: number,
  ) {
    const store = readStore();
    const repair = store.cases.find(
      (item) => item.voiceCall?.providerKey === providerKey(providerId),
    );
    if (!repair?.voiceCall) throw new Error("Voice status did not match an approved call.");
    const duplicate = applyVoiceTransport(repair, eventKey, status, sequence);
    if (!duplicate) {
      repair.updatedAt = now();
      writeStore(store);
    }
    return { repair, duplicate };
  },

  recordVoiceFailure(
    providerId: string,
    eventKey: string,
    reason: string,
    provisional = false,
  ) {
    const store = readStore();
    const repair = store.cases.find(
      (item) => item.voiceCall?.providerKey === providerKey(providerId),
    );
    if (!repair?.voiceCall) throw new Error("Voice failure did not match an approved call.");
    const call = repair.voiceCall;
    const duplicate = call.handledCallbacks.includes(eventKey);
    if (!duplicate) {
      call.handledCallbacks.push(eventKey);
      if (!call.outcome || (!provisional && call.outcomeProvisional)) {
        if (call.outcomeProvisional) {
          repair.manualContactTasks = repair.manualContactTasks?.filter(
            ({ approvalId }) => approvalId !== call.approvalId,
          );
        }
        call.outcome = "needs_manual_follow_up";
        call.outcomeProvisional = provisional || undefined;
        call.outcomeSummary = reason;
        addManualContactTask(repair, reason);
      }
      repair.updatedAt = now();
      writeStore(store);
    }
    return { repair, duplicate };
  },

  voiceCallContext(providerId: string, eventKey?: string) {
    const store = readStore();
    const repair = store.cases.find(
      (item) => item.voiceCall?.providerKey === providerKey(providerId),
    );
    if (!repair?.voiceCall) throw new Error("Voice callback did not match an approved call.");
    return {
      caseId: repair.id,
      consentGranted:
        repair.voiceCall.perCallConsent === "granted" &&
        Boolean(repair.voiceCall.consentAt) &&
        repair.voiceCall.sipBridgeOffered &&
        repair.voiceCall.openAiConnectionStatus === "not_requested" &&
        (!repair.voiceCall.outcome || repair.voiceCall.outcomeProvisional) &&
        hasCurrentVoiceAuthority(repair),
      duplicate: eventKey ? repair.voiceCall.handledCallbacks.includes(eventKey) : false,
      outcome: repair.voiceCall.outcome,
      outcomeProvisional: repair.voiceCall.outcomeProvisional,
      authority: {
        contractorAlias: "contractor" as const,
        proposalId: repair.proposal?.id,
        storedPrice: repair.callApproval?.storedPrice,
        managerTimeWindow: repair.callApproval?.managerTimeWindow,
        tenantTimeWindow: repair.callApproval?.tenantAccess.timeWindow,
      },
    };
  },

  claimOpenAiVoiceConnection(providerId: string, eventKey: string) {
    const store = readStore();
    const repair = store.cases.find(
      (item) => item.voiceCall?.providerKey === providerKey(providerId),
    );
    if (!repair?.voiceCall) throw new Error("Voice callback did not match an approved call.");
    const call = repair.voiceCall;
    const duplicate = call.handledCallbacks.includes(eventKey);
    if (!duplicate) {
      if (
        call.perCallConsent !== "granted" ||
        !call.consentAt ||
        !call.sipBridgeOffered ||
        call.openAiConnectionStatus !== "not_requested" ||
        (call.outcome && !call.outcomeProvisional) ||
        !hasCurrentVoiceAuthority(repair)
      ) {
        throw new Error("OpenAI cannot connect before per-call keypad consent.");
      }
      call.handledCallbacks.push(eventKey);
      call.openAiConnectionStatus = "accepting";
      repair.updatedAt = now();
      writeStore(store);
    }
    return {
      repair,
      duplicate,
      authority: {
        contractorAlias: "contractor" as const,
        proposalId: repair.proposal?.id,
        storedPrice: repair.callApproval?.storedPrice,
        managerTimeWindow: repair.callApproval?.managerTimeWindow,
        tenantTimeWindow: repair.callApproval?.tenantAccess.timeWindow,
      },
    };
  },

  completeOpenAiVoiceConnection(providerId: string, eventKey: string) {
    return mutateCase(
      repairStore.voiceCallContext(providerId).caseId,
      (repair) => {
        const call = repair.voiceCall;
        if (
          !call ||
          !call.handledCallbacks.includes(eventKey) ||
          call.openAiConnectionStatus !== "accepting"
        ) {
          return;
        }
        call.openAiConnected = true;
        call.openAiConnectionStatus = "connected";
        repair.activity.push(activity("Consented OpenAI voice session connected", "system"));
      },
    );
  },

  failOpenAiVoiceConnection(providerId: string, eventKey: string) {
    return mutateCase(
      repairStore.voiceCallContext(providerId).caseId,
      (repair) => {
        const call = repair.voiceCall;
        if (
          !call ||
          !call.handledCallbacks.includes(eventKey) ||
          call.openAiConnectionStatus !== "accepting"
        ) {
          return;
        }
        call.openAiConnectionStatus = "unknown";
        addManualContactTask(
          repair,
          "OpenAI call acceptance ended ambiguously; do not reconnect automatically.",
        );
      },
    );
  },

  appendVoiceTranscript(
    providerId: string,
    eventKey: string,
    party: "contractor" | "agent",
    text: string,
  ) {
    const store = readStore();
    const repair = store.cases.find(
      (item) => item.voiceCall?.providerKey === providerKey(providerId),
    );
    if (!repair?.voiceCall) throw new Error("Voice transcript did not match an approved call.");
    const call = repair.voiceCall;
    const duplicate = call.handledCallbacks.includes(eventKey);
    if (!duplicate) {
      if (call.perCallConsent !== "granted" || !call.consentAt || !call.openAiConnected) {
        throw new Error("Transcript content requires a consented OpenAI call.");
      }
      // ponytail: bound one controlled call in JSON; move transcripts to dedicated storage for longer calls.
      if (
        text.length > maxTranscriptEntryCharacters ||
        call.transcript.length >= maxTranscriptEntries ||
        call.transcript.reduce((total, entry) => total + entry.text.length, 0) + text.length >
          maxTranscriptCharacters
      ) {
        throw new Error("Voice transcript exceeded the controlled-call storage limit.");
      }
      call.handledCallbacks.push(eventKey);
      call.transcript.push({ party, text, recordedAt: now() });
      repair.updatedAt = now();
      writeStore(store);
    }
    return { repair, duplicate };
  },

  recordVoiceOutcome(
    providerId: string,
    eventKey: string,
    input: {
      outcome: "confirmed" | "declined" | "requested_change" | "ambiguous" | "consent_withdrawn";
      summary: string;
      finalTimeWindow?: string;
    },
  ) {
    const store = readStore();
    const repair = store.cases.find(
      (item) => item.voiceCall?.providerKey === providerKey(providerId),
    );
    if (!repair?.voiceCall) throw new Error("Voice outcome did not match an approved call.");
    const call = repair.voiceCall;
    if (call.handledCallbacks.includes(eventKey)) {
      return { repair, duplicate: true, shouldWake: false };
    }
    const withdrawing = input.outcome === "consent_withdrawn";
    if (call.outcome && !call.outcomeProvisional && !withdrawing) {
      throw new Error("A voice outcome is already recorded for this call.");
    }
    if (call.perCallConsent !== "granted" || !call.consentAt || !call.openAiConnected) {
      throw new Error("A voice outcome requires a consented OpenAI call.");
    }
    if (call.outcomeProvisional) {
      call.outcome = undefined;
      call.outcomeSummary = undefined;
      call.outcomeProvisional = undefined;
      repair.manualContactTasks = repair.manualContactTasks?.filter(
        ({ approvalId }) => approvalId !== call.approvalId,
      );
    }
    call.handledCallbacks.push(eventKey);

    const approval = repair.callApproval;
    const proposal = repair.proposal;
    const confirmedInsideAuthority = Boolean(
      input.outcome === "confirmed" &&
        input.finalTimeWindow &&
        approval &&
        proposal &&
        hasCurrentVoiceAuthority(repair) &&
        isInsideTimeWindow(input.finalTimeWindow, approval.managerTimeWindow) &&
        isInsideTimeWindow(input.finalTimeWindow, approval.tenantAccess.timeWindow),
    );

    if (withdrawing) {
      const withdrawnAt = now();
      const bookingEffect = repair.repairAgent?.effects.find(
        (effect) => effect.effectKey === `sms:tenant:booking:${call.approvalId}`,
      );
      if (bookingEffect && ["planned", "retryable"].includes(bookingEffect.status)) {
        bookingEffect.status = "superseded";
        bookingEffect.updatedAt = withdrawnAt;
      }
      if (
        repair.contractorConfirmation &&
        "approvalId" in repair.contractorConfirmation &&
        repair.contractorConfirmation.approvalId === call.approvalId
      ) {
        repair.contractorConfirmation = undefined;
        repair.appointment = undefined;
        if (repair.proposal) repair.proposal.status = "approved";
        repair.status = "approved";
      }
      call.outcome = "consent_withdrawn";
      call.perCallConsent = "withdrawn";
      call.transcript = [];
      call.transcriptDeletedAt = withdrawnAt;
      if (store.controlledLive) store.controlledLive.voiceEnrollmentWithdrawnAt = withdrawnAt;
      addManualContactTask(repair, "The contractor withdrew consent during the call.");
      repair.activity.push(
        activity("Voice consent withdrawn; transcript deleted", "contractor"),
      );
    } else if (confirmedInsideAuthority && input.finalTimeWindow && proposal && approval) {
      call.outcome = "confirmed";
      call.outcomeSummary = input.summary;
      repair.contractorConfirmation = {
        source: "consented_voice",
        approvalId: approval.id,
        providerCallKey: call.providerKey,
        contractorAlias: "contractor",
        consentAt: call.consentAt,
        proposalId: proposal.id,
        timeWindow: input.finalTimeWindow,
        recordedAt: now(),
      };
      proposal.status = "booked";
      repair.appointment = {
        contractorName: proposal.contractorName,
        timeWindow: input.finalTimeWindow,
        bookedAt: now(),
      };
      repair.status = "scheduled";
      const effectKey = `sms:tenant:booking:${approval.id}`;
      const state = repairAgentState(repair);
      if (!state.effects.some((effect) => effect.effectKey === effectKey)) {
        const createdAt = now();
        state.effects.push({
          effectKey,
          type: "tenant_sms",
          target: "tenant",
          purpose: "booking_confirmation",
          body: appointmentNotification(repair).body,
          status: "planned",
          attempts: 0,
          createdAt,
          updatedAt: createdAt,
        });
      }
      repair.activity.push(
        activity("Consented contractor confirmation recorded", "contractor", input.finalTimeWindow),
        activity(`Visit booked with ${proposal.contractorName}`, "agent", input.finalTimeWindow),
      );
      state.phase = "idle";
    } else {
      call.outcome = input.outcome === "confirmed" ? "requested_change" : input.outcome;
      call.outcomeSummary = input.summary;
      addManualContactTask(
        repair,
        input.outcome === "confirmed"
          ? "The contractor's proposed slot was outside the approved timing authority."
          : `Contractor outcome: ${input.outcome}.`,
      );
    }
    repair.updatedAt = now();
    writeStore(store);
    return {
      repair,
      duplicate: false,
      shouldWake: call.outcome === "confirmed",
    };
  },

  failAgentEffect(
    caseId: string,
    effectKey: string,
    status: Extract<OutboundEffect["status"], "retryable" | "unknown" | "failed">,
  ) {
    return mutateCase(caseId, (repair) => {
      const state = repairAgentState(repair);
      const effect = state.effects.find(
        (item) => item.effectKey === effectKey,
      );
      if (!effect || effect.status !== "dispatching") return;
      if (
        effect.type === "contractor_call" &&
        status === "retryable" &&
        repair.callApproval?.id === effect.approvalId &&
        repair.callApproval.revokedAt
      ) {
        effect.status = "superseded";
        effect.updatedAt = now();
        repair.callApproval = undefined;
        return;
      }
      effect.status =
        status === "unknown" || status === "failed"
          ? status
          : state.tenantMessaging === "stopped"
            ? "superseded"
            : status;
      effect.updatedAt = now();
      if (effect.status === "unknown") {
        surfaceUnknownEffect(repair, effect);
      } else if (effect.type === "contractor_call") {
        if (effect.status === "retryable") {
          repair.activity.push(
            activity(
              "Provider rejected the contractor call before acceptance",
              "system",
              "The same approved call record may retry.",
            ),
          );
        }
      } else if (effect.status === "failed") {
        if (effect.purpose === "booking_confirmation") {
          addManualContactTask(
            repair,
            "The tenant booking confirmation could not be delivered after three provider rejections.",
            repair.callApproval?.id,
          );
        }
        repair.activity.push(
          activity(
            effect.purpose === "booking_confirmation"
              ? "Tenant booking confirmation delivery failed"
              : "Tenant reply delivery failed",
            "system",
            "The provider rejected three attempts before accepting the text.",
          ),
        );
      }
    });
  },

  reconcileOutboundEffect(
    caseId: string,
    effectKey: string,
    resolution: "absent" | "accepted",
    providerId?: string,
    providerStatus?: NonNullable<RepairCase["voiceCall"]>["transportStatus"],
  ) {
    return mutateCase(caseId, (repair, store) => {
      const effect = repairAgentState(repair).effects.find(
        (item) => item.effectKey === effectKey,
      );
      if (!effect) throw new Error("There is no outbound effect to reconcile.");
      if (effect.type === "contractor_call") {
        if (
          effect.status !== "unknown" ||
          repair.callApproval?.id !== effect.approvalId ||
          repair.callApproval.callsConsumed !== 0
        ) {
          throw new Error("There is no unknown approved call to reconcile.");
        }
        if (resolution === "accepted") {
          if (!providerId || !providerStatus) {
            throw new Error("A provider-created call requires its CallSid and current status.");
          }
          completeContractorCallEffect(repair, effect, providerId);
          if (!repair.voiceCall) return;
          applyVoiceTransport(
            repair,
            providerKey(`manager:call-reconciliation:${effect.effectKey}:${providerStatus}`),
            providerStatus,
          );
          repair.activity.push(
            activity(
              "Provider-created contractor call reconciled",
              "manager",
              `…${providerId.slice(-6)}; ${providerStatus}`,
            ),
          );
          return;
        }
        const revoked = Boolean(repair.callApproval.revokedAt);
        effect.status = revoked ? "superseded" : "retryable";
        effect.updatedAt = now();
        if (revoked) repair.callApproval = undefined;
        repair.manualContactTasks = repair.manualContactTasks?.filter(
          ({ approvalId }) => approvalId !== effect.approvalId,
        );
        repair.activity.push(
          activity(
            "Provider confirmed no contractor call was created",
            "manager",
            revoked
              ? "The revoked call record is closed without retry."
              : "The same approved call record may retry.",
          ),
        );
        return;
      }
      if (resolution === "accepted") {
        if (effect.status !== "unknown") {
          throw new Error("Only an unknown tenant text can be recorded as accepted.");
        }
        completeTenantTextEffect(repair, store, effect, { delivery: "twilio" }, true);
      } else if (["unknown", "retryable", "failed"].includes(effect.status)) {
        const stopped = repairAgentState(repair).tenantMessaging === "stopped";
        effect.status = stopped ? "superseded" : "retryable";
        effect.updatedAt = now();
        repair.activity.push(
          activity(
            "Provider confirmed no tenant text was accepted",
            "manager",
            stopped
              ? "The saved text was closed because tenant messaging is stopped."
              : "The same saved text may retry.",
          ),
        );
      } else {
        throw new Error("There is no unresolved tenant text to reconcile.");
      }
      if (effect.purpose === "booking_confirmation") {
        repair.manualContactTasks = repair.manualContactTasks?.filter(
          ({ approvalId, reason }) =>
            approvalId !== repair.callApproval?.id || !reason.includes("booking confirmation"),
        );
      }
    });
  },

  recoverAgentWork() {
    const store = readStore();
    let changed = false;
    const resumable: string[] = [];
    for (const repair of store.cases) {
      const state = repair.repairAgent;
      if (!state) continue;
      const photoJobs = (store.photoEvidenceJobs ?? []).filter(
        (job) => job.caseId === repair.id,
      );
      state.tenantMessaging ??= "active";
      let repairChanged = false;
      if (
        repair.voiceCall &&
        (!repair.voiceCall.outcome || repair.voiceCall.outcomeProvisional) &&
        ["accepting", "connected"].includes(repair.voiceCall.openAiConnectionStatus)
      ) {
        repair.voiceCall.openAiConnectionStatus = "unknown";
        repair.voiceCall.openAiConnected = false;
        addManualContactTask(
          repair,
          "The OpenAI call connection was interrupted; do not reconnect automatically.",
        );
        changed = repairChanged = true;
      }
      if (state.activeRun) {
        state.events
          .filter((event) => event.status === "claimed")
          .forEach(
            (event) =>
              (event.status = state.tenantMessaging === "stopped" ? "handled" : "pending"),
          );
        finishRun(repair, "interrupted");
        state.phase = state.tenantMessaging === "stopped" ? "stopped" : "pending";
        changed = repairChanged = true;
      }
      for (const effect of state.effects.filter((item) => item.status === "dispatching")) {
        effect.status = "unknown";
        effect.updatedAt = now();
        surfaceUnknownEffect(repair, effect);
        changed = repairChanged = true;
      }
      if (state.tenantMessaging === "stopped") {
        for (const effect of state.effects.filter(
          (item) => item.status === "planned" || item.status === "retryable",
        )) {
          effect.status = "superseded";
          effect.updatedAt = now();
          changed = repairChanged = true;
        }
      }
      for (const job of photoJobs.filter((item) => item.status === "fetching")) {
        job.status = state.tenantMessaging === "stopped" ? "superseded" : "retryable";
        job.updatedAt = now();
        changed = repairChanged = true;
      }
      if (state.tenantMessaging === "stopped") {
        for (const job of photoJobs.filter(
          (item) => item.status === "pending" || item.status === "retryable",
        )) {
          job.status = "superseded";
          job.updatedAt = now();
          changed = repairChanged = true;
        }
      }
      if (
        state.tenantMessaging === "active" &&
        (state.events.some((event) => event.status === "pending") ||
          state.effects.some(
            (effect) => effect.status === "planned" || effect.status === "retryable",
          ) ||
          photoJobs.some((job) => job.status === "pending" || job.status === "retryable"))
      ) {
        resumable.push(repair.id);
      }
      if (repairChanged) repair.updatedAt = now();
    }
    if (changed) writeStore(store);
    return resumable;
  },

  receiveDemoMessage(input: DemoMessageInput) {
    if (!isDemoMode()) throw new Error("The synthetic message simulator is disabled.");
    return mutateCase(DEMO_CASE_ID, (repair, store) => {
      const party = input.sender;
      const from =
        party === "tenant"
          ? repair.tenant.phone
          : store.contractorAgreements.find(
              (agreement) => agreement.id === repair.demoFixture?.backupAgreementId,
            )?.contractorPhone;
      applyInboundMessage(repair, {
        party,
        from,
        body: input.body,
        mediaId: input.mediaId,
        activityLabel:
          party === "tenant"
            ? "Maya Chen (demo tenant) sent a simulated message"
            : "Three Rivers Demo Plumbing sent a simulated message",
      });
    });
  },

  triage(caseId: string, input: TriageInput) {
    return mutateCase(caseId, (repair) => {
      repair.title = input.title;
      repair.summary = input.summary;
      repair.severity = input.severity;
      repair.trade = input.trade;
      repair.accessNotes = input.accessNotes;
      repair.requiredBy = input.requiredBy;
      repair.activity.push(activity("Agent reviewed the repair", "agent", input.summary));
    });
  },

  addMessage(
    caseId: string,
    party: RepairMessage["party"],
    body: string,
    details: Pick<RepairMessage, "from"> = {},
  ) {
    return mutateCase(caseId, (repair) => {
      repair.messages.push(
        message(party, body, party === "manager" ? "dashboard" : "sms", details),
      );
      const name = party === "tenant" ? repair.tenant.name : party[0].toUpperCase() + party.slice(1);
      repair.activity.push(activity(`${name} sent a message`, party, body));
    });
  },

  propose(caseId: string, input: ProposalInput) {
    return mutateCase(caseId, (repair) => {
      if (!repair.externalSearch) {
        throw new Error(
          "External contractor search must be authorized before adding an external proposal.",
        );
      }
      if (repair.status === "scheduled" || repair.status === "closed") {
        throw new Error("A proposal cannot be added to a finished repair.");
      }
      repair.proposal = {
        id: randomUUID(),
        ...input,
        currency: "GBP",
        source: "external",
        priceBasis: "External quote",
        status: "proposed",
      };
      clearApprovalAndConfirmations(repair);
      repair.status = "waiting_for_approval";
      repair.activity.push(
        activity(`${input.contractorName} offered a time`, "contractor", input.timeWindow),
        activity("Waiting for your approval", "system"),
      );
    });
  },

  approve(caseId: string, approvedBy: string) {
    return mutateCase(caseId, (repair) => {
      if (!repair.proposal) throw new Error("There is no contractor proposal to approve.");
      if (repair.status !== "waiting_for_approval") {
        throw new Error("This repair is not waiting for approval.");
      }
      repair.approval = {
        approvedBy,
        approvedAt: now(),
        proposalId: repair.proposal.id,
        timeWindow: repair.proposal.timeWindow,
      };
      repair.proposal.status = "approved";
      repair.status = "approved";
      repair.activity.push(activity(`${approvedBy} approved the repair`, "manager"));
    });
  },

  approveContractorCall(caseId: string, input: ContractorCallApprovalInput) {
    if (!isControlledLiveMode()) {
      throw new Error("Call approval is only available in CONTROLLED_LIVE_MODE.");
    }
    return mutateCase(caseId, (repair, store) => {
      const withdrawalAt = store.controlledLive?.voiceEnrollmentWithdrawnAt;
      if (
        withdrawalAt &&
        Date.parse(controlledLiveVoiceConfig().enrollmentConsentAt) <= Date.parse(withdrawalAt)
      ) {
        throw new Error("Contractor voice enrollment was withdrawn; use manual contact.");
      }
      requireControlledLiveManagerReview(repair);
      const proposal = repair.proposal;
      const access = repair.tenantAccessAuthorization;
      const state = repairAgentState(repair);
      const agreement = store.contractorAgreements.find(
        ({ id }) => id === input.agreementId,
      );
      if (repair.callApproval) throw new Error("One contractor call is already approved.");
      if (
        state.effects.some(
          (effect) =>
            effect.type === "tenant_sms" &&
              ["planned", "dispatching", "retryable", "unknown", "failed"].includes(
                effect.status,
              ),
        )
      ) {
        throw new Error("Finish or inspect the pending tenant text before approving a call.");
      }
      if (
        state.effects.some(
          (effect) =>
            effect.type === "contractor_call" &&
            ["dispatching", "succeeded", "unknown"].includes(effect.status),
        )
      ) {
        throw new Error("One contractor call is already approved.");
      }
      if (
        repair.status !== "waiting_for_approval" ||
        !proposal ||
        proposal.id !== input.proposalId ||
        proposal.source !== "agreement" ||
        proposal.agreementId !== input.agreementId ||
        proposal.contractorPhone !== "contractor" ||
        proposal.costPence !== input.costPence ||
        proposal.currency !== input.currency ||
        proposal.timeWindow !== input.managerTimeWindow ||
        state.revision !== input.caseRevision ||
        !agreement ||
        agreement.contractorPhone !== "contractor" ||
        agreement.pricing.amountPence !== input.costPence ||
        agreement.pricing.currency !== input.currency ||
        !access ||
        access.proposalId !== input.proposalId ||
        access.sourceMessageId !== input.tenantAccessSourceMessageId ||
        access.timeWindow !== input.tenantTimeWindow
      ) {
        throw new Error("The contractor call facts changed. Review the current case before approving.");
      }
      const approvedAt = now();
      const approvalId = `approval:${proposal.id}:revision-${state.revision}`;
      repair.approval = {
        approvedBy: "Property manager",
        approvedAt,
        proposalId: proposal.id,
        timeWindow: proposal.timeWindow,
      };
      repair.callApproval = {
        id: approvalId,
        approvedBy: "Property manager",
        approvedAt,
        proposalId: proposal.id,
        caseRevision: state.revision,
        contractorAlias: "contractor",
        agreementId: agreement.id,
        storedPrice: {
          costPence: agreement.pricing.amountPence,
          currency: "USD",
          priceBasis: agreement.pricing.description,
        },
        managerTimeWindow: proposal.timeWindow,
        tenantAccess: structuredClone(access),
        callsAuthorized: 1,
        callsConsumed: 0,
      };
      state.effects.push({
        effectKey: `call:contractor:${approvalId}`,
        type: "contractor_call",
        target: "contractor",
        approvalId,
        status: "planned",
        attempts: 0,
        createdAt: approvedAt,
        updatedAt: approvedAt,
      });
      proposal.status = "approved";
      repair.status = "approved";
      state.revision += 1;
      repair.activity.push(
        activity(
          "Property manager approved one contractor call",
          "manager",
          `${agreement.contractorName} (contractor alias); ${new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
          }).format(agreement.pricing.amountPence / 100)} ${agreement.pricing.description}; manager window ${proposal.timeWindow}; tenant window ${access.timeWindow}; one outbound call.`,
        ),
      );
    });
  },

  recordTenantAccessAuthorization(
    caseId: string,
    input: TenantAccessAuthorizationInput,
  ) {
    return mutateCase(caseId, (repair) => {
      if (repair.appointment) throw new Error("A booked visit cannot change access authority.");
      if (isControlledLiveMode() && !timeWindowBounds(input.timeWindow)) {
        throw new Error("Use an ISO 8601 start/end time window.");
      }
      const nextAccess = messageEvidenceForCurrentProposal(
        repair,
        input,
        "tenant",
      );
      const currentAccess = repair.tenantAccessAuthorization;
      if (
        currentAccess?.sourceMessageId === nextAccess.sourceMessageId &&
        currentAccess.proposalId === nextAccess.proposalId &&
        currentAccess.timeWindow === nextAccess.timeWindow
      ) {
        return;
      }
      if (isControlledLiveMode()) {
        invalidateCallApproval(repair, "The tenant access timing changed.");
        repairAgentState(repair).revision += 1;
      }
      repair.tenantAccessAuthorization = nextAccess;
      repair.activity.push(
        activity("Tenant access recorded", "tenant", input.timeWindow),
      );
    });
  },

  recordContractorConfirmation(
    caseId: string,
    input: ContractorConfirmationInput,
  ) {
    return mutateCase(caseId, (repair) => {
      repair.contractorConfirmation = messageEvidenceForCurrentProposal(
        repair,
        input,
        "contractor",
      );
      repair.activity.push(
        activity("Contractor confirmation recorded", "contractor", input.timeWindow),
      );
    });
  },

  book(caseId: string) {
    return mutateCase(caseId, (repair, store) => {
      if (repair.appointment?.notificationId) throw new Error("This visit is already booked.");
      if (repair.appointment) return;
      if (
        !repair.proposal ||
        repair.status !== "approved" ||
        !matchesCurrentProposal(repair.approval, repair.proposal)
      ) {
        throw new Error("The property manager must approve the proposal before booking.");
      }
      if (!matchesCurrentProposal(repair.tenantAccessAuthorization, repair.proposal)) {
        throw new Error(
          "Tenant access must match the current proposal and visit window before booking.",
        );
      }
      if (!matchesCurrentProposal(repair.contractorConfirmation, repair.proposal)) {
        throw new Error(
          "Contractor confirmation must match the current proposal and visit window before booking.",
        );
      }
      repair.proposal.status = "booked";
      repair.appointment = {
        contractorName: repair.proposal.contractorName,
        timeWindow: repair.proposal.timeWindow,
        bookedAt: now(),
      };
      repair.status = "scheduled";
      repair.activity.push(
        activity(`Visit booked with ${repair.proposal.contractorName}`, "agent", repair.proposal.timeWindow),
      );
      if (isDemoMode()) {
        const { to, body } = appointmentNotification(repair);
        const notification = outboxMessage(to, body, "demo_outbox", repair.id);
        store.outbox.push(notification);
        repair.notifications = [notification];
        repair.appointment.notificationId = notification.id;
      }
    });
  },

  findOutbox(caseId: string, body: string) {
    return readStore().outbox.find((item) => item.caseId === caseId && item.body === body);
  },

  addOutbox(to: string, body: string, delivery: OutboundText["delivery"], caseId?: string) {
    const store = readStore();
    const existing = caseId
      ? store.outbox.find((item) => item.caseId === caseId && item.body === body)
      : undefined;
    if (existing) return existing;
    const outbound = outboxMessage(to, body, delivery, caseId);
    store.outbox.push(outbound);
    writeStore(store);
    return outbound;
  },

  recordAppointmentNotification(caseId: string, notification: OutboundText) {
    return mutateCase(caseId, (repair) => {
      if (!repair.appointment) throw new Error("There is no booked visit to notify.");
      if (repair.appointment.notificationId === notification.id) return;
      repair.appointment.notificationId = notification.id;
      repair.notifications = [notification];
    });
  },

  outbox() {
    return readStore().outbox;
  },

  resetControlledLive(resetAt = new Date()) {
    if (!isControlledLiveMode()) {
      throw new Error("Controlled reset requires CONTROLLED_LIVE_MODE.");
    }
    const current = readStore();
    const hasActiveWork = current.cases.some(
      (repair) =>
        Boolean(repair.repairAgent?.activeRun) ||
        repair.repairAgent?.effects.some(({ status }) =>
          ["planned", "dispatching", "retryable", "unknown"].includes(status),
        ) ||
        (repair.voiceCall &&
          (
            !["completed", "busy", "failed", "no-answer", "canceled"].includes(
              repair.voiceCall.transportStatus,
            ) ||
            ((repair.voiceCall.outcomeProvisional || !repair.voiceCall.outcome) &&
              ["accepting", "connected"].includes(
                repair.voiceCall.openAiConnectionStatus,
              ))
          )),
    );
    if (
      hasActiveWork ||
      current.photoEvidenceJobs?.some(({ status }) =>
        ["pending", "fetching", "retryable"].includes(status),
      )
    ) {
      throw new Error("Finish or inspect active provider work before controlled reset.");
    }
    const handledVoiceCallbacks = [
      ...(current.controlledLive?.handledVoiceCallbacks ?? []),
      ...current.cases.flatMap((repair) => repair.voiceCall?.handledCallbacks ?? []),
    ].filter((value, index, values) => values.indexOf(value) === index);
    const handledSmsEvents = [
      ...(current.controlledLive?.handledSmsEvents ?? []),
      ...current.cases.flatMap(
        (repair) => repair.repairAgent?.events.map(({ sourceKey }) => sourceKey) ?? [],
      ),
    ].filter((value, index, values) => values.indexOf(value) === index);
    const reset = cloneSeed(resetAt);
    reset.controlledLive = {
      handledVoiceCallbacks,
      handledSmsEvents,
      retiredVoiceCallKeys: [
        ...(current.controlledLive?.retiredVoiceCallKeys ?? []),
        ...current.cases.flatMap((repair) =>
          repair.voiceCall ? [repair.voiceCall.providerKey] : [],
        ),
      ].filter((value, index, values) => values.indexOf(value) === index),
      ...(current.controlledLive?.voiceEnrollmentWithdrawnAt
        ? { voiceEnrollmentWithdrawnAt: current.controlledLive.voiceEnrollmentWithdrawnAt }
        : {}),
      ...(current.controlledLive?.tenantMessagingStoppedAt
        ? { tenantMessagingStoppedAt: current.controlledLive.tenantMessagingStoppedAt }
        : {}),
    };
    writeStore(reset);
    return reset;
  },

  reset(resetAt = new Date()) {
    const store = cloneSeed(resetAt);
    writeStore(store);
    return store;
  },
};
