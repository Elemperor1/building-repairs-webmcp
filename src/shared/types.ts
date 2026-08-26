export type RepairStatus =
  | "new"
  | "waiting_for_approval"
  | "approved"
  | "scheduled"
  | "closed";

export type Severity = "routine" | "urgent" | "emergency";
export type MessageParty = "tenant" | "agent" | "manager" | "contractor";
export type Trade = "plumbing" | "electrical" | "heating" | "locksmith" | "general";
export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

export interface ContractorAgreement {
  id: string;
  buildingId: string;
  trade: Trade;
  contractorName: string;
  contractorPhone: string;
  priority: number;
  coveredWork: string;
  coveredSeverities: Severity[];
  pricing: {
    basis: "fixed" | "rate_schedule";
    amountPence: number;
    description: string;
  };
  coverageHours: {
    description: string;
    timeZone: string;
    days: Weekday[];
    startsAt: string;
    endsAt: string;
  };
  responseMinutes: Record<Severity, number>;
  effectiveFrom: string;
  effectiveTo: string;
}

export interface RepairMessage {
  id: string;
  party: MessageParty;
  body: string;
  sentAt: string;
  channel: "sms" | "dashboard";
}

export interface ActivityEvent {
  id: string;
  label: string;
  detail?: string;
  actor: MessageParty | "system";
  occurredAt: string;
}

export interface ContractorProposal {
  id: string;
  contractorName: string;
  contractorPhone: string;
  timeWindow: string;
  costPence: number;
  currency: "GBP";
  reason: string;
  source: "agreement" | "external";
  agreementId?: string;
  priceBasis: string;
  status: "proposed" | "approved" | "booked";
}

export interface Approval {
  approvedBy: string;
  approvedAt: string;
}

export interface Appointment {
  contractorName: string;
  timeWindow: string;
  bookedAt: string;
}

export interface RepairCase {
  id: string;
  buildingId: string;
  title: string;
  summary: string;
  severity: Severity;
  trade: Trade;
  status: RepairStatus;
  tenant: {
    name: string;
    unit: string;
    phone: string;
  };
  accessNotes?: string;
  createdAt: string;
  updatedAt: string;
  messages: RepairMessage[];
  activity: ActivityEvent[];
  contractorAttempts: ContractorAttempt[];
  externalSearchRequest?: {
    requestedBy: string;
    requestedAt: string;
    requiredBy: string;
  };
  externalSearch?: ExternalSearchAuthorization;
  proposal?: ContractorProposal;
  approval?: Approval;
  appointment?: Appointment;
}

export interface ContractorAttempt {
  id: string;
  agreementId: string;
  contractorName: string;
  reason: string;
  earliestAvailableAt: string;
  recordedAt: string;
}

export interface ExternalSearchAuthorization {
  authorizedAt: string;
  requiredBy: string;
  reason: string;
  requestedByManager?: string;
  searchBrief: {
    buildingId: string;
    trade: Trade;
    severity: Severity;
    requiredBy: string;
  };
}

export interface OutboundText {
  id: string;
  to: string;
  body: string;
  sentAt: string;
  delivery: "local_outbox" | "twilio";
}

export interface AppStore {
  cases: RepairCase[];
  contractorAgreements: ContractorAgreement[];
  outbox: OutboundText[];
}

export interface CaseListResponse {
  cases: RepairCase[];
}

export interface InboundSmsInput {
  from: string;
  body: string;
  tenantName?: string;
  unit?: string;
}

export interface TriageInput {
  title: string;
  summary: string;
  severity: Severity;
  trade: Trade;
  accessNotes?: string;
}

export interface ProposalInput {
  contractorName: string;
  contractorPhone: string;
  timeWindow: string;
  costPence: number;
  reason: string;
}
