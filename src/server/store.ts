import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  ActivityEvent,
  AppStore,
  InboundSmsInput,
  ProposalInput,
  RepairCase,
  RepairMessage,
  TriageInput,
} from "../shared/types.js";
import { contractorSelection } from "./contractor-selection.js";
import { seedStore } from "./seed.js";

const storePath = resolve(process.cwd(), ".data/store.json");

const cloneSeed = (): AppStore => structuredClone(seedStore);

const ensureStore = () => {
  mkdirSync(dirname(storePath), { recursive: true });
  try {
    readFileSync(storePath, "utf8");
  } catch {
    writeFileSync(storePath, JSON.stringify(cloneSeed(), null, 2));
  }
};

const readStore = (): AppStore => {
  ensureStore();
  return JSON.parse(readFileSync(storePath, "utf8")) as AppStore;
};

const writeStore = (store: AppStore) => {
  mkdirSync(dirname(storePath), { recursive: true });
  const temporaryPath = `${storePath}.next`;
  writeFileSync(temporaryPath, JSON.stringify(store, null, 2));
  renameSync(temporaryPath, storePath);
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
): RepairMessage => ({
  id: randomUUID(),
  party,
  body,
  channel,
  sentAt: now(),
});

const availabilityLabel = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(value));

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
        currency: "GBP",
        reason: input.reason,
        source: "agreement",
        agreementId: agreement.id,
        priceBasis: agreement.pricing.description,
        status: "proposed",
      };
      selectedRepair.approval = undefined;
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
    });
    const updatedRepair = mutateCase(caseId, (selectedRepair) => {
      selectedRepair.contractorAttempts.push(update.attempt);
      if (selectedRepair.proposal?.agreementId === input.agreementId) {
        selectedRepair.proposal = undefined;
        selectedRepair.approval = undefined;
        selectedRepair.status = "new";
      }
      selectedRepair.activity.push(
        activity(
          `${update.attempt.contractorName} is unavailable`,
          "contractor",
          `${update.attempt.reason} Earliest availability: ${availabilityLabel(
            update.attempt.earliestAvailableAt,
          )}.`,
        ),
      );
    });
    return { repair: updatedRepair, decision: update.decision };
  },

  startExternalSearch(
    caseId: string,
    input: { requiredBy: string },
  ) {
    const store = readStore();
    const repair = store.cases.find((item) => item.id === caseId);
    if (!repair) throw new Error("Repair case not found.");
    const authorization = contractorSelection.startExternalSearch({
      repair,
      agreements: store.contractorAgreements,
      requiredBy: input.requiredBy,
      requestedByManager: repair.externalSearchRequest?.requestedBy,
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
          `Options required by ${availabilityLabel(input.requiredBy)}.`,
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
      existing.messages.push(message("tenant", input.body, "sms"));
      existing.activity.push(activity(`${existing.tenant.name} sent a text`, "tenant", input.body));
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
      messages: [message("tenant", input.body, "sms")],
      activity: [activity(`${tenantName} reported a repair`, "tenant", input.body)],
      contractorAttempts: [],
    };
    store.cases.push(repair);
    writeStore(store);
    return repair;
  },

  triage(caseId: string, input: TriageInput) {
    return mutateCase(caseId, (repair) => {
      repair.title = input.title;
      repair.summary = input.summary;
      repair.severity = input.severity;
      repair.trade = input.trade;
      repair.accessNotes = input.accessNotes;
      repair.activity.push(activity("Agent reviewed the repair", "agent", input.summary));
    });
  },

  addMessage(caseId: string, party: RepairMessage["party"], body: string) {
    return mutateCase(caseId, (repair) => {
      repair.messages.push(message(party, body, party === "manager" ? "dashboard" : "sms"));
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
      repair.approval = undefined;
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
      repair.approval = { approvedBy, approvedAt: now() };
      repair.proposal.status = "approved";
      repair.status = "approved";
      repair.activity.push(activity(`${approvedBy} approved the repair`, "manager"));
    });
  },

  book(caseId: string) {
    return mutateCase(caseId, (repair) => {
      if (!repair.proposal || !repair.approval || repair.status !== "approved") {
        throw new Error("The property manager must approve the proposal before booking.");
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
    });
  },

  addOutbox(to: string, body: string, delivery: "local_outbox" | "twilio") {
    const store = readStore();
    store.outbox.push({ id: randomUUID(), to, body, sentAt: now(), delivery });
    writeStore(store);
  },

  outbox() {
    return readStore().outbox;
  },

  reset() {
    const store = cloneSeed();
    writeStore(store);
    return store;
  },
};
