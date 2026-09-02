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
  photoEvidenceIds?: string[];
}

export type PhotoEvidenceContentType = "image/jpeg" | "image/png" | "image/webp";

export interface PhotoEvidence {
  id: string;
  messageId: string;
  status: "pending" | "available" | "rejected";
  receivedAt: string;
  contentType?: PhotoEvidenceContentType;
  byteLength?: number;
  sha256?: string;
  rejectionReason?: string;
}

export interface PhotoEvidenceJob {
  id: string;
  caseId: string;
  messageId: string;
  sourceUrl: string;
  sourceMessageSid: string;
  expectedContentType: string;
  status: "pending" | "fetching" | "retryable" | "available" | "rejected" | "superseded";
  receivedAt: string;
  updatedAt: string;
  contentType?: PhotoEvidenceContentType;
  dataBase64?: string;
  byteLength?: number;
  sha256?: string;
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

export interface ContractorCallApproval {
  id: string;
  approvedBy: "Property manager";
  approvedAt: string;
  proposalId: string;
  caseRevision: number;
  contractorAlias: "contractor";
  agreementId: string;
  storedPrice: {
    costPence: number;
    currency: "USD";
    priceBasis: string;
  };
  managerTimeWindow: string;
  tenantAccess: TenantAccessAuthorization;
  callsAuthorized: 1;
  callsConsumed: 0 | 1;
  revokedAt?: string;
  revokedReason?: string;
}

export interface ContractorCallApprovalInput {
  proposalId: string;
  caseRevision: number;
  agreementId: string;
  costPence: number;
  currency: "USD";
  managerTimeWindow: string;
  tenantAccessSourceMessageId: string;
  tenantTimeWindow: string;
}

export interface TenantAccessAuthorization {
  sourceMessageId: string;
  proposalId: string;
  timeWindow: string;
  recordedAt: string;
}

export type TenantAccessAuthorizationInput = Omit<TenantAccessAuthorization, "recordedAt">;

export interface MessageContractorConfirmation {
  sourceMessageId: string;
  proposalId: string;
  timeWindow: string;
  recordedAt: string;
}

export interface VoiceContractorConfirmation {
  source: "consented_voice";
  approvalId: string;
  providerCallKey: string;
  contractorAlias: "contractor";
  consentAt: string;
  proposalId: string;
  timeWindow: string;
  recordedAt: string;
}

export type ContractorConfirmation = MessageContractorConfirmation | VoiceContractorConfirmation;
export type ContractorConfirmationInput = Omit<MessageContractorConfirmation, "recordedAt">;

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

export type AgentWakeEventStatus = "pending" | "claimed" | "handled";
export type RepairAgentRunStatus =
  | "active"
  | "completed"
  | "failed"
  | "superseded"
  | "interrupted";
export type OutboundEffectStatus =
  | "planned"
  | "dispatching"
  | "succeeded"
  | "retryable"
  | "superseded"
  | "unknown"
  | "failed";

export interface AgentWakeEvent {
  id: string;
  sourceKey: string;
  sequence: number;
  messageId: string;
  status: AgentWakeEventStatus;
  receivedAt: string;
}

export interface RepairAgentRun {
  id: string;
  status: RepairAgentRunStatus;
  snapshotRevision: number;
  highWater: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

interface OutboundEffectBase {
  effectKey: string;
  status: OutboundEffectStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  delivery?: OutboundText["delivery"];
  providerId?: string;
  providerKey?: string;
}

export interface TenantSmsEffect extends OutboundEffectBase {
  type: "tenant_sms";
  target: "tenant";
  body: string;
  purpose?: "agent_reply" | "booking_confirmation";
}

export interface ContractorCallEffect extends OutboundEffectBase {
  type: "contractor_call";
  target: "contractor";
  approvalId: string;
}

export type OutboundEffect = TenantSmsEffect | ContractorCallEffect;

export interface ContractorVoiceCall {
  effectKey: string;
  approvalId: string;
  providerId: string;
  providerKey: string;
  enrollmentConsentAt: string;
  disclosureServed: boolean;
  perCallConsent: "not_requested" | "pending" | "granted" | "declined" | "timed_out" | "withdrawn";
  consentAt?: string;
  sipBridgeOffered: boolean;
  openAiConnected: boolean;
  openAiConnectionStatus: "not_requested" | "accepting" | "connected" | "unknown";
  transportStatus: "queued" | "initiated" | "ringing" | "in-progress" | "completed" | "busy" | "failed" | "no-answer" | "canceled";
  transportSequence?: number;
  outcome?:
    | "confirmed"
    | "declined"
    | "requested_change"
    | "ambiguous"
    | "consent_withdrawn"
    | "consent_declined"
    | "no_consent_response"
    | "unreachable"
    | "failed"
    | "needs_manual_follow_up";
  outcomeProvisional?: boolean;
  outcomeSummary?: string;
  transcriptDeletedAt?: string;
  transcript: Array<{
    party: "contractor" | "agent";
    text: string;
    recordedAt: string;
  }>;
  handledCallbacks: string[];
}

export interface ManualContactTask {
  id: string;
  approvalId: string;
  reason: string;
  status: "open";
  createdAt: string;
}

export interface RepairAgentState {
  revision: number;
  nextSequence: number;
  phase:
    | "idle"
    | "pending"
    | "working"
    | "waiting_for_tenant"
    | "waiting_for_manager"
    | "stopped";
  tenantMessaging: "active" | "stopped";
  events: AgentWakeEvent[];
  runs: RepairAgentRun[];
  activeRun?: RepairAgentRun;
  effects: OutboundEffect[];
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
  callApproval?: ContractorCallApproval;
  voiceCall?: ContractorVoiceCall;
  manualContactTasks?: ManualContactTask[];
  tenantAccessAuthorization?: TenantAccessAuthorization;
  contractorConfirmation?: ContractorConfirmation;
  appointment?: Appointment;
  notifications?: OutboundText[];
  photoEvidence?: PhotoEvidence[];
  repairAgent?: RepairAgentState;
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
  photoEvidenceJobs?: PhotoEvidenceJob[];
  controlledLive?: {
    voiceEnrollmentWithdrawnAt?: string;
    tenantMessagingStoppedAt?: string;
    handledVoiceCallbacks: string[];
    handledSmsEvents: string[];
    retiredVoiceCallKeys: string[];
  };
}

export interface CaseListResponse {
  cases: RepairCase[];
  demoMode: boolean;
  controlledLiveMode: boolean;
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
