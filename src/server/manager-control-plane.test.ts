import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { repairStore } from "./store.js";

const managerPassword = "test-manager-password-that-is-long";
const managerAuthorization = `Basic ${Buffer.from(`manager:${managerPassword}`).toString("base64")}`;
const tenantPhone = "+14125550101";
const contractorPhone = "+14125550103";

const startServer = async () => {
  const app = createApp({ scheduleAgentRun: () => undefined });
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
};

const stopServer = (server: Server) =>
  new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

const managerPost = (baseUrl: string, path: string, body: unknown) =>
  fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: managerAuthorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

describe("controlled-live manager control plane", () => {
  const servers: Server[] = [];

  beforeEach(() => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("CONTROLLED_LIVE_MODE", "true");
    vi.stubEnv("PUBLIC_BASE_URL", "https://live.fix-this.test");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC11111111111111111111111111111111");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "test-auth-token");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+14125550102");
    vi.stubEnv("CONTROLLED_LIVE_TENANT_PHONE", tenantPhone);
    vi.stubEnv("CONTROLLED_LIVE_CONTRACTOR_PHONE", contractorPhone);
    vi.stubEnv("CONTROLLED_LIVE_MANAGER_PASSWORD", managerPassword);
    vi.stubEnv("CONTROLLED_LIVE_AGREEMENT_PRICE_CENTS", "16050");
    vi.stubEnv("CONTROLLED_LIVE_CONTRACTOR_VOICE_ENROLLED_AT", "2026-08-29T09:00:00.000Z");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("OPENAI_TEXT_MODEL", "test-text-model");
    vi.stubEnv("OPENAI_PROJECT_ID", "proj_test");
    vi.stubEnv("OPENAI_WEBHOOK_SECRET", "whsec_test-secret-that-is-long");
    repairStore.reset();
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(stopServer));
    vi.unstubAllEnvs();
  });

  it("serves accepted photo bytes only to the authenticated manager and redacts the shared case", async () => {
    const sourceMessageSid = "SM11111111111111111111111111111111";
    const sourceUrl = `https://api.twilio.com/2010-04-01/Accounts/AC11111111111111111111111111111111/Messages/${sourceMessageSid}/Media/ME${"a".repeat(32)}`;
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);
    const { repair } = repairStore.receiveVerifiedSms({
      sourceKey: "deduplicated-provider-key",
      body: "Here is the bathroom photo.",
      photos: [
        {
          sourceUrl,
          messageSid: sourceMessageSid,
          expectedContentType: "image/jpeg",
        },
      ],
    });
    const job = repairStore.claimPhotoEvidenceJob(repair.id)!;
    repairStore.completePhotoEvidenceJob(repair.id, job.jobId, {
      contentType: "image/jpeg",
      dataBase64: jpeg.toString("base64"),
    });
    const evidenceId = repair.photoEvidence![0]!.id;
    const { server, baseUrl } = await startServer();
    servers.push(server);

    const unauthenticated = await fetch(
      `${baseUrl}/api/cases/${repair.id}/evidence/${evidenceId}`,
    );
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("www-authenticate")).toContain("Basic");

    const caseResponse = await fetch(`${baseUrl}/api/cases/${repair.id}`, {
      headers: { Authorization: managerAuthorization },
    });
    expect(caseResponse.status).toBe(200);
    expect(caseResponse.headers.get("x-frame-options")).toBe("DENY");
    expect(caseResponse.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'none'",
    );
    const visible = await caseResponse.json();
    expect(visible).toMatchObject({
      repair: {
        tenant: { phone: "tenant" },
        photoEvidence: [
          expect.objectContaining({
            id: evidenceId,
            status: "available",
            contentType: "image/jpeg",
            byteLength: jpeg.byteLength,
          }),
        ],
      },
    });
    const serialized = JSON.stringify(visible);
    for (const secret of [tenantPhone, contractorPhone, sourceUrl, sourceMessageSid, jpeg.toString("base64")]) {
      expect(serialized).not.toContain(secret);
    }

    const evidenceResponse = await fetch(
      `${baseUrl}/api/cases/${repair.id}/evidence/${evidenceId}`,
      { headers: { Authorization: managerAuthorization } },
    );
    expect(evidenceResponse.status).toBe(200);
    expect(evidenceResponse.headers.get("content-type")).toBe("image/jpeg");
    expect(evidenceResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await evidenceResponse.arrayBuffer())).toEqual(jpeg);
  });

  it("records one exact manager call approval without letting preparation create authority", async () => {
    const sourceMessageSid = "SM22222222222222222222222222222222";
    const { repair } = repairStore.receiveVerifiedSms({
      sourceKey: "tenant-access-message",
      body: "You can come between 2 and 4 tomorrow.",
      photos: [
        {
          sourceUrl: `https://api.twilio.com/2010-04-01/Accounts/AC11111111111111111111111111111111/Messages/${sourceMessageSid}/Media/ME${"b".repeat(32)}`,
          messageSid: sourceMessageSid,
          expectedContentType: "image/jpeg",
        },
      ],
    });
    const run = repairStore.startAgentRun(repair.id)!;
    repairStore.commitAgentDecision(repair.id, run.runId, {
      nextStep: "manager_review",
      title: "Bathroom leak",
      summary: "A bathroom pipe is leaking and needs a plumber.",
      severity: "urgent",
      trade: "plumbing",
      tenantReply: "Thanks. The property manager will review this.",
      managerReason: "Photo accepted; prepare the approved plumber action.",
    });
    const sourceMessageId = repairStore.get(repair.id).messages[0]!.id;
    const managerTimeWindow = "2026-09-01T13:00:00.000Z/2026-09-01T17:00:00.000Z";
    const tenantTimeWindow = "2026-09-01T14:00:00.000Z/2026-09-01T16:00:00.000Z";
    const { server, baseUrl } = await startServer();
    servers.push(server);

    expect(
      (
        await managerPost(baseUrl, `/api/cases/${repair.id}/contractor-proposal`, {
          agreementId: "controlled-live-agreement",
          timeWindow: managerTimeWindow,
          reason: "Stored plumbing agreement",
        })
      ).status,
    ).toBe(409);

    const photoJob = repairStore.claimPhotoEvidenceJob(repair.id)!;
    repairStore.completePhotoEvidenceJob(repair.id, photoJob.jobId, {
      contentType: "image/jpeg",
      dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0xdb]).toString("base64"),
    });
    repairStore.receiveVerifiedSms({
      sourceKey: "photo-follow-up",
      body: "That is the photo of the leak.",
    });
    const reviewRun = repairStore.startAgentRun(repair.id)!;
    repairStore.commitAgentDecision(repair.id, reviewRun.runId, {
      nextStep: "manager_review",
      title: "Bathroom leak",
      summary: "A bathroom pipe is leaking and needs a plumber.",
      severity: "urgent",
      trade: "plumbing",
      tenantReply: "Thanks. The property manager will review this.",
      managerReason: "Accepted photo is ready for property-manager review.",
    });
    const tenantReply = repairStore.claimAgentEffect(repair.id)!;
    repairStore.completeAgentEffect(repair.id, tenantReply.effectKey, {
      delivery: "twilio",
      providerId: "SM33333333333333333333333333333333",
    });

    const proposalResponse = await managerPost(
      baseUrl,
      `/api/cases/${repair.id}/contractor-proposal`,
      {
        agreementId: "controlled-live-agreement",
        timeWindow: managerTimeWindow,
        reason: "Stored plumbing agreement",
      },
    );
    expect(proposalResponse.status).toBe(200);
    const proposed = (await proposalResponse.json()).repair;
    expect(proposed).toMatchObject({
      proposal: {
        agreementId: "controlled-live-agreement",
        contractorPhone: "contractor",
        costPence: 16050,
        currency: "USD",
        timeWindow: managerTimeWindow,
        status: "proposed",
      },
    });
    expect(proposed.approval).toBeUndefined();
    expect(proposed.callApproval).toBeUndefined();
    expect(proposed.activity).toContainEqual(
      expect.objectContaining({
        label: "Approved agreement option prepared",
        actor: "agent",
      }),
    );
    expect(JSON.stringify(proposed.activity)).not.toContain("offered a time");

    const accessResponse = await managerPost(
      baseUrl,
      `/api/cases/${repair.id}/access-authorization`,
      {
        sourceMessageId,
        proposalId: proposed.proposal.id,
        timeWindow: tenantTimeWindow,
      },
    );
    expect(accessResponse.status).toBe(200);
    const prepared = (await accessResponse.json()).repair;
    const authority = {
      proposalId: prepared.proposal.id,
      caseRevision: prepared.repairAgent.revision,
      agreementId: prepared.proposal.agreementId,
      costPence: prepared.proposal.costPence,
      currency: prepared.proposal.currency,
      managerTimeWindow,
      tenantAccessSourceMessageId: sourceMessageId,
      tenantTimeWindow,
    };

    const altered = await managerPost(baseUrl, `/api/cases/${repair.id}/call-approval`, {
      ...authority,
      costPence: authority.costPence + 1,
    });
    expect(altered.status).toBe(409);
    expect(repairStore.get(repair.id).callApproval).toBeUndefined();

    const approvalResponse = await managerPost(
      baseUrl,
      `/api/cases/${repair.id}/call-approval`,
      authority,
    );
    expect(approvalResponse.status).toBe(200);
    const approved = (await approvalResponse.json()).repair;
    expect(approved.callApproval).toMatchObject({
      proposalId: authority.proposalId,
      caseRevision: authority.caseRevision,
      contractorAlias: "contractor",
      agreementId: "controlled-live-agreement",
      storedPrice: {
        costPence: 16050,
        currency: "USD",
      },
      managerTimeWindow,
      tenantAccess: {
        sourceMessageId,
        timeWindow: tenantTimeWindow,
      },
      callsAuthorized: 1,
      callsConsumed: 0,
    });
    expect(approved.approval).toMatchObject({ proposalId: authority.proposalId });
    const authorityEvent = approved.activity.find(
      ({ label }: { label: string }) =>
        label === "Property manager approved one contractor call",
    );
    expect(authorityEvent?.detail).toContain("Approved contractor");
    expect(authorityEvent?.detail).toContain("$160.50");
    expect(authorityEvent?.detail).toContain(managerTimeWindow);
    expect(authorityEvent?.detail).toContain(tenantTimeWindow);
    expect(authorityEvent?.detail).toContain("one outbound call");

    expect(
      (
        await managerPost(baseUrl, `/api/cases/${repair.id}/call-approval`, authority)
      ).status,
    ).toBe(409);

    const changedTenantTimeWindow =
      "2026-09-01T14:30:00.000Z/2026-09-01T16:00:00.000Z";
    const changedAccessResponse = await managerPost(
      baseUrl,
      `/api/cases/${repair.id}/access-authorization`,
      {
        sourceMessageId,
        proposalId: authority.proposalId,
        timeWindow: changedTenantTimeWindow,
      },
    );
    expect(changedAccessResponse.status).toBe(200);
    const changedAccess = (await changedAccessResponse.json()).repair;
    expect(changedAccess).toMatchObject({
      status: "waiting_for_approval",
      proposal: { status: "proposed" },
    });
    expect(changedAccess.approval).toBeUndefined();
    expect(changedAccess.callApproval).toBeUndefined();
    expect(
      changedAccess.activity.find(
        ({ label }: { label: string }) =>
          label === "Property manager approved one contractor call",
      )?.detail,
    ).toBe(authorityEvent?.detail);
    expect(changedAccess.repairAgent.revision).toBeGreaterThan(
      approved.repairAgent.revision,
    );

    const reapprovalResponse = await managerPost(
      baseUrl,
      `/api/cases/${repair.id}/call-approval`,
      {
        ...authority,
        caseRevision: changedAccess.repairAgent.revision,
        tenantTimeWindow: changedTenantTimeWindow,
      },
    );
    expect(reapprovalResponse.status).toBe(200);

    repairStore.receiveVerifiedSms({
      sourceKey: "changed-case-fact",
      body: "The leak is spreading now.",
    });
    const changedCase = repairStore.get(repair.id);
    expect(changedCase.callApproval).toBeUndefined();
    expect(changedCase.approval).toBeUndefined();
    expect(changedCase.proposal?.status).toBe("proposed");
  });

  it("keeps emergency manager review moving without waiting for a photo", () => {
    const { repair } = repairStore.receiveVerifiedSms({
      sourceKey: "emergency-message",
      body: "A bathroom pipe burst and water is pouring through the ceiling.",
    });
    const run = repairStore.startAgentRun(repair.id)!;
    repairStore.commitAgentDecision(repair.id, run.runId, {
      nextStep: "manager_review",
      title: "Burst bathroom pipe",
      summary: "A burst pipe is flooding the bathroom and needs urgent manager action.",
      severity: "emergency",
      trade: "plumbing",
      tenantReply: "Keep clear and follow the emergency safety guidance.",
      managerReason: "Emergency reports bypass the photo wait.",
    });
    const managerTimeWindow =
      "2026-09-01T13:00:00.000Z/2026-09-01T17:00:00.000Z";
    const tenantTimeWindow =
      "2026-09-01T14:00:00.000Z/2026-09-01T16:00:00.000Z";
    const proposed = repairStore.proposePreferred(repair.id, {
      agreementId: "controlled-live-agreement",
      timeWindow: managerTimeWindow,
      reason: "Stored emergency plumbing agreement",
    });
    const sourceMessageId = proposed.messages[0]!.id;
    const prepared = repairStore.recordTenantAccessAuthorization(repair.id, {
      sourceMessageId,
      proposalId: proposed.proposal!.id,
      timeWindow: tenantTimeWindow,
    });

    const authority = {
      proposalId: prepared.proposal!.id,
      caseRevision: prepared.repairAgent!.revision,
      agreementId: prepared.proposal!.agreementId!,
      costPence: prepared.proposal!.costPence,
      currency: "USD" as const,
      managerTimeWindow,
      tenantAccessSourceMessageId: sourceMessageId,
      tenantTimeWindow,
    };
    expect(() => repairStore.approveContractorCall(repair.id, authority)).toThrow(
      "pending tenant text",
    );
    const safetyReply = repairStore.claimAgentEffect(repair.id)!;
    repairStore.completeAgentEffect(repair.id, safetyReply.effectKey, {
      delivery: "twilio",
      providerId: "SM44444444444444444444444444444444",
    });
    const approved = repairStore.approveContractorCall(repair.id, authority);

    expect(approved.callApproval?.callsAuthorized).toBe(1);
    expect(approved.photoEvidence).toBeUndefined();
  });
});
