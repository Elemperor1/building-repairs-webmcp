import type {
  CaseListResponse,
  ContractorCallApprovalInput,
  ContractorConfirmationInput,
  DemoMessageInput,
  InboundSmsInput,
  ProposalInput,
  RepairCase,
  TenantAccessAuthorizationInput,
  TriageInput,
} from "../shared/types";

interface RepairResponse {
  repair: RepairCase;
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status}).`);
  return data;
};

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });

export const api = {
  async listCases() {
    return request<CaseListResponse>("/api/cases");
  },

  async getCase(caseId: string) {
    return (await request<RepairResponse>(`/api/cases/${caseId}`)).repair;
  },

  async getContractorPath(caseId: string) {
    return request<{ decision: unknown }>(`/api/cases/${caseId}/contractor-path`);
  },

  async simulateInboundText(input: InboundSmsInput) {
    return (await post<RepairResponse>("/api/sms/inbound", input)).repair;
  },

  async simulateDemoMessage(input: DemoMessageInput) {
    return (await post<RepairResponse>("/api/demo/messages", input)).repair;
  },

  async resetDemo() {
    return post<{ resetAt: string; caseId: string }>("/api/demo/reset");
  },

  async triage(caseId: string, input: TriageInput) {
    return (await post<RepairResponse>(`/api/cases/${caseId}/triage`, input)).repair;
  },

  async sendTenantMessage(caseId: string, body: string) {
    return (await post<RepairResponse>(`/api/cases/${caseId}/messages/tenant`, { body })).repair;
  },

  async sendManagerNote(caseId: string, body: string) {
    return (await post<RepairResponse>(`/api/cases/${caseId}/messages/manager`, { body })).repair;
  },

  async proposeExternal(caseId: string, input: ProposalInput) {
    return (await post<RepairResponse>(`/api/cases/${caseId}/proposal`, input)).repair;
  },

  async proposePreferred(
    caseId: string,
    input: { agreementId: string; timeWindow: string; reason: string },
  ) {
    return (await post<RepairResponse>(`/api/cases/${caseId}/contractor-proposal`, input)).repair;
  },

  async recordContractorUnavailable(
    caseId: string,
    input: { agreementId: string; reason: string; earliestAvailableAt: string },
  ) {
    return post<{ repair: RepairCase; decision: unknown }>(
      `/api/cases/${caseId}/contractor-attempts/unavailable`,
      input,
    );
  },

  async startExternalSearch(caseId: string, requiredBy?: string) {
    return post<{ repair: RepairCase; authorization: unknown }>(
      `/api/cases/${caseId}/external-search`,
      { requiredBy },
    );
  },

  async requestExternalSearch(caseId: string, requestedBy: string, requiredBy: string) {
    return (
      await post<RepairResponse>(`/api/cases/${caseId}/external-search/request`, {
        requestedBy,
        requiredBy,
      })
    ).repair;
  },

  async approve(caseId: string, approvedBy = "Property manager") {
    return (await post<RepairResponse>(`/api/cases/${caseId}/approve`, { approvedBy })).repair;
  },

  async approveContractorCall(caseId: string, input: ContractorCallApprovalInput) {
    return (await post<RepairResponse>(`/api/cases/${caseId}/call-approval`, input)).repair;
  },

  async reconcileOutboundEffect(
    caseId: string,
    effectKey: string,
    resolution: "absent" | "accepted",
    providerId?: string,
    providerStatus?: NonNullable<RepairCase["voiceCall"]>["transportStatus"],
  ) {
    return (
      await post<RepairResponse>(`/api/cases/${caseId}/effect-reconciliation`, {
        effectKey,
        resolution,
        confirmation:
          resolution === "accepted"
            ? "provider confirms outbound effect was accepted"
            : "provider confirms no outbound effect was accepted; reconcile saved record",
        ...(providerId ? { providerId } : {}),
        ...(providerStatus ? { providerStatus } : {}),
      })
    ).repair;
  },

  async recordTenantAccessAuthorization(caseId: string, input: TenantAccessAuthorizationInput) {
    return (await post<RepairResponse>(`/api/cases/${caseId}/access-authorization`, input)).repair;
  },

  async recordContractorConfirmation(caseId: string, input: ContractorConfirmationInput) {
    return (await post<RepairResponse>(`/api/cases/${caseId}/contractor-confirmation`, input)).repair;
  },

  async book(caseId: string) {
    return (await post<RepairResponse>(`/api/cases/${caseId}/book`)).repair;
  },
};
