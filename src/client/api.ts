import type {
  CaseListResponse,
  InboundSmsInput,
  ProposalInput,
  RepairCase,
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
    return (await request<CaseListResponse>("/api/cases")).cases;
  },

  async getCase(caseId: string) {
    return (await request<RepairResponse>(`/api/cases/${caseId}`)).repair;
  },

  async simulateInboundText(input: InboundSmsInput) {
    return (await post<RepairResponse>("/api/sms/inbound", input)).repair;
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

  async propose(caseId: string, input: ProposalInput) {
    return (await post<RepairResponse>(`/api/cases/${caseId}/proposal`, input)).repair;
  },

  async approve(caseId: string, approvedBy = "Property manager") {
    return (await post<RepairResponse>(`/api/cases/${caseId}/approve`, { approvedBy })).repair;
  },

  async book(caseId: string) {
    return (await post<RepairResponse>(`/api/cases/${caseId}/book`)).repair;
  },
};
