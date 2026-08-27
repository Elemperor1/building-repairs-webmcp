import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  ActivityEvent,
  AppStore,
  ContractorConfirmationInput,
  DemoMessageInput,
  InboundSmsInput,
  OutboundText,
  ProposalInput,
  RepairCase,
  RepairMessage,
  TenantAccessAuthorizationInput,
  TriageInput,
} from "../shared/types.js";
import { contractorSelection } from "./contractor-selection.js";
import { createDemoStore, DEMO_CASE_ID, isDemoMode } from "./demo.js";
import { seedStore } from "./seed.js";

const storePath = () =>
  resolve(process.cwd(), isDemoMode() ? ".data/demo-store.json" : ".data/store.json");

const cloneSeed = (resetAt = new Date()): AppStore =>
  isDemoMode() ? createDemoStore(resetAt) : structuredClone(seedStore);

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
  return JSON.parse(readFileSync(storePath(), "utf8")) as AppStore;
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
  details: Pick<RepairMessage, "from" | "mediaId"> = {},
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
    repair.proposal.timeWindow !== input.timeWindow
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

const clearApprovalAndConfirmations = (repair: RepairCase) => {
  repair.approval = undefined;
  repair.tenantAccessAuthorization = undefined;
  repair.contractorConfirmation = undefined;
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
      clearApprovalAndConfirmations(selectedRepair);
      selectedRepair.status = "waiting_for_approval";
      selectedRepair.activity.push(
        activity(`${agreement.contractorName} offered a time`, "contractor", input.timeWindow),
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

  recordTenantAccessAuthorization(
    caseId: string,
    input: TenantAccessAuthorizationInput,
  ) {
    return mutateCase(caseId, (repair) => {
      repair.tenantAccessAuthorization = messageEvidenceForCurrentProposal(
        repair,
        input,
        "tenant",
      );
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

  reset(resetAt = new Date()) {
    const store = cloneSeed(resetAt);
    writeStore(store);
    return store;
  },
};
