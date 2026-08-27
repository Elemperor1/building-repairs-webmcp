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
    currency: "GBP" | "USD";
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
  channel: "sms" | "mms" | "dashboard";
  from?: string;
  mediaId?: "demo-bathroom-leak";
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
  currency: "GBP" | "USD";
  reason: string;
  source: "agreement" | "external";
  agreementId?: string;
  priceBasis: string;
  status: "proposed" | "approved" | "booked";
}

export interface Approval {
  approvedBy: string;
  approvedAt: string;
  proposalId: string;
  timeWindow: string;
}

export interface TenantAccessAuthorization {
  sourceMessageId: string;
  proposalId: string;
  timeWindow: string;
  recordedAt: string;
}

export type TenantAccessAuthorizationInput = Omit<TenantAccessAuthorization, "recordedAt">;

export interface ContractorConfirmation {
  sourceMessageId: string;
  proposalId: string;
  timeWindow: string;
  recordedAt: string;
}

export type ContractorConfirmationInput = Omit<ContractorConfirmation, "recordedAt">;

export interface Appointment {
  contractorName: string;
  timeWindow: string;
  bookedAt: string;
  notificationId?: string;
}

export interface DemoFixture {
  organization: {
    id: "demo-pa-org";
    name: "Fix This Demo Property Management";
    jurisdiction: "US-PA";
    timeZone: "America/New_York";
  };
  building: {
    id: "demo-pa-building";
    name: "Hawthorn Court Demo Apartments";
    address: "100 Demo Way, Pittsburgh, PA 15222";
  };
  manager: { id: "demo-manager-priya"; name: "Priya Shah (demo manager)" };
  tenantId: "demo-tenant-maya";
  mediaId: "demo-bathroom-leak";
  resetAt: string;
  primaryAgreementId: "demo-pa-plumbing-primary";
  backupAgreementId: "demo-pa-plumbing-backup";
  accessWindow: string;
  primaryEarliestAvailableAt: string;
  backupVisitWindow: string;
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
  requiredBy?: string;
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
  tenantAccessAuthorization?: TenantAccessAuthorization;
  contractorConfirmation?: ContractorConfirmation;
  appointment?: Appointment;
  notifications?: OutboundText[];
  demoFixture?: DemoFixture;
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
  caseId?: string;
  to: string;
  body: string;
  sentAt: string;
  delivery: "demo_outbox" | "local_outbox" | "twilio";
}

export interface AppStore {
  cases: RepairCase[];
  contractorAgreements: ContractorAgreement[];
  outbox: OutboundText[];
}

export interface CaseListResponse {
  cases: RepairCase[];
  demoMode: boolean;
}

export interface InboundSmsInput {
  from: string;
  body: string;
  tenantName?: string;
  unit?: string;
}

export interface DemoMessageInput {
  sender: "tenant" | "contractor";
  body: string;
  mediaId?: "demo-bathroom-leak";
}

export interface TriageInput {
  title: string;
  summary: string;
  severity: Severity;
  trade: Trade;
  accessNotes?: string;
  requiredBy?: string;
}

export interface ProposalInput {
  contractorName: string;
  contractorPhone: string;
  timeWindow: string;
  costPence: number;
  reason: string;
}
