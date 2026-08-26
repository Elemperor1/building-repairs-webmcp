export type RepairStatus =
  | "new"
  | "waiting_for_approval"
  | "approved"
  | "scheduled"
  | "closed";

export type Severity = "routine" | "urgent" | "emergency";
export type MessageParty = "tenant" | "agent" | "manager" | "contractor";

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
  proposal?: ContractorProposal;
  approval?: Approval;
  appointment?: Appointment;
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
  accessNotes?: string;
}

export interface ProposalInput {
  contractorName: string;
  contractorPhone: string;
  timeWindow: string;
  costPence: number;
  reason: string;
}
