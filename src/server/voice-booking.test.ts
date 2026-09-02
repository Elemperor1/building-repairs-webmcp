import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import twilio from "twilio";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createRepairAgent, KnownTextDeliveryFailure } from "./repair-agent.js";
import { repairStore } from "./store.js";
import {
  createOpenAiVoiceHandler,
  KnownCallStartFailure,
  startControlledContractorCall,
} from "./voice.js";

const managerPassword = "test-manager-password-that-is-long";
const managerAuthorization = `Basic ${Buffer.from(`manager:${managerPassword}`).toString("base64")}`;
const publicBaseUrl = "https://live.fix-this.test";
const accountSid = "AC11111111111111111111111111111111";
const authToken = "test-auth-token";
const servicePhone = "+14125550102";
const contractorPhone = "+14125550103";
const managerTimeWindow = "2026-09-01T13:00:00.000Z/2026-09-01T17:00:00.000Z";
const tenantTimeWindow = "2026-09-01T14:00:00.000Z/2026-09-01T16:00:00.000Z";

const startServer = async (app: ReturnType<typeof createApp>) => {
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

const postTwilioVoice = (
  baseUrl: string,
  path: "consent" | "consent-result" | "status" | "sip-complete",
  body: Record<string, string>,
  approvedCallId = repairStore.list()[0]?.callApproval?.id,
) => {
  if (!approvedCallId) throw new Error("Test callback requires an approved call.");
  const callbackPath = `/api/voice/twilio/${path}?approval=${encodeURIComponent(approvedCallId)}`;
  return fetch(`${baseUrl}${callbackPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": twilio.getExpectedTwilioSignature(
        authToken,
        `${publicBaseUrl}${callbackPath}`,
        body,
      ),
    },
    body: new URLSearchParams(body),
  });
};

const prepareManagerReadyCase = (sourceKey = "tenant-emergency-message") => {
  const { repair } = repairStore.receiveVerifiedSms({
    sourceKey,
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
  const tenantReply = repairStore.claimAgentEffect(repair.id)!;
  repairStore.completeAgentEffect(repair.id, tenantReply.effectKey, {
    delivery: "twilio",
    providerId: "SM00000000000000000000000000000000",
  });
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
  return {
    caseId: repair.id,
    approval: {
      proposalId: prepared.proposal!.id,
      caseRevision: prepared.repairAgent!.revision,
      agreementId: prepared.proposal!.agreementId!,
      costPence: prepared.proposal!.costPence,
      currency: "USD" as const,
      managerTimeWindow,
      tenantAccessSourceMessageId: sourceMessageId,
      tenantTimeWindow,
    },
  };
};

const prepareStartedCall = (callSid: string) => {
  const { caseId, approval } = prepareManagerReadyCase();
  repairStore.approveContractorCall(caseId, approval);
  const callEffect = repairStore.claimAgentEffect(caseId)!;
  repairStore.completeContractorCallEffect(caseId, callEffect.effectKey, callSid);
  return { caseId, approval };
};

const prepareConsentedCall = (callSid: string) => {
  const prepared = prepareStartedCall(callSid);
  repairStore.recordVoiceDisclosure(callSid, `disclosure:${callSid}`);
  repairStore.recordVoiceConsent(callSid, `consent:${callSid}`, "granted");
  repairStore.claimVoiceSipBridge(callSid);
  repairStore.claimOpenAiVoiceConnection(callSid, `openai:${callSid}`);
  repairStore.completeOpenAiVoiceConnection(callSid, `openai:${callSid}`);
  return prepared;
};

describe("controlled-live consented voice booking", () => {
  const servers: Server[] = [];

  beforeEach(() => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("CONTROLLED_LIVE_MODE", "true");
    vi.stubEnv("PUBLIC_BASE_URL", publicBaseUrl);
    vi.stubEnv("TWILIO_ACCOUNT_SID", accountSid);
    vi.stubEnv("TWILIO_AUTH_TOKEN", authToken);
    vi.stubEnv("TWILIO_PHONE_NUMBER", servicePhone);
    vi.stubEnv("CONTROLLED_LIVE_TENANT_PHONE", "+14125550101");
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

  it("starts exactly one alias-bound contractor call after manager approval", async () => {
    const starts: unknown[] = [];
    const agent = createRepairAgent({
      prepareManagerReview: async () => {
        throw new Error("No text-agent run expected.");
      },
      sendTenantText: async () => ({ delivery: "twilio", providerId: "SM-not-used" }),
      startContractorCall: async (input) => {
        starts.push(input);
        return { providerId: "CA11111111111111111111111111111111" };
      },
    });
    const { caseId, approval } = prepareManagerReadyCase();
    const { server, baseUrl } = await startServer(createApp({ scheduleAgentRun: agent.wake }));
    servers.push(server);

    const response = await fetch(`${baseUrl}/api/cases/${caseId}/call-approval`, {
      method: "POST",
      headers: {
        Authorization: managerAuthorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(approval),
    });
    expect(response.status).toBe(200);
    await agent.idle();

    const repair = repairStore.get(caseId);
    expect(starts).toEqual([
      expect.objectContaining({
        target: "contractor",
        approvalId: repair.callApproval?.id,
      }),
    ]);
    expect(repair.callApproval).toMatchObject({ callsAuthorized: 1, callsConsumed: 1 });
    expect(repair.repairAgent?.effects.filter(({ type }) => type === "contractor_call")).toEqual([
      expect.objectContaining({
        type: "contractor_call",
        target: "contractor",
        status: "succeeded",
        attempts: 1,
        providerId: "…111111",
      }),
    ]);
  });

  it("resolves the outbound call only from the controlled bindings", async () => {
    let requestUrl = "";
    let requestBody = "";
    const result = await startControlledContractorCall(
      {
        caseId: "controlled-live-repair",
        effectKey: "call:one",
        target: "contractor",
        approvalId: "approval:one",
      },
      {
        env: process.env,
        fetch: async (input, init) => {
          requestUrl = String(input);
          requestBody = String(init?.body);
          return new Response(
            JSON.stringify({ sid: "CA12121212121212121212121212121212" }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        },
      },
    );

    expect(result).toEqual({ providerId: "CA12121212121212121212121212121212" });
    expect(requestUrl).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
    );
    const body = new URLSearchParams(requestBody);
    expect(Object.fromEntries(body)).toMatchObject({
      To: contractorPhone,
      From: servicePhone,
      Url: `${publicBaseUrl}/api/voice/twilio/consent?approval=approval%3Aone`,
      StatusCallback: `${publicBaseUrl}/api/voice/twilio/status?approval=approval%3Aone`,
      TimeLimit: "300",
    });
  });

  it("binds an early signed callback before the call-start response is persisted", async () => {
    const callSid = "CA23232323232323232323232323232323";
    const { caseId, approval } = prepareManagerReadyCase();
    repairStore.approveContractorCall(caseId, approval);
    const effect = repairStore.claimAgentEffect(caseId)!;
    const { server, baseUrl } = await startServer(createApp());
    servers.push(server);

    const response = await postTwilioVoice(baseUrl, "consent", {
      AccountSid: accountSid,
      CallSid: callSid,
      From: servicePhone,
      To: contractorPhone,
    });
    repairStore.completeContractorCallEffect(caseId, effect.effectKey, callSid);

    expect(response.status).toBe(200);
    expect(repairStore.get(caseId)).toMatchObject({
      callApproval: { callsConsumed: 1 },
      voiceCall: { providerId: "…232323", disclosureServed: true },
      repairAgent: {
        effects: [
          expect.anything(),
          expect.objectContaining({ type: "contractor_call", status: "succeeded" }),
        ],
      },
    });
  });

  it("retries a known pre-acceptance call failure on the same effect", async () => {
    let starts = 0;
    const agent = createRepairAgent({
      prepareManagerReview: async () => {
        throw new Error("No text-agent run expected.");
      },
      sendTenantText: async () => ({ delivery: "twilio", providerId: "SM-not-used" }),
      startContractorCall: async () => {
        starts += 1;
        if (starts === 1) throw new KnownCallStartFailure("Twilio rejected the request.");
        return { providerId: "CA88888888888888888888888888888888" };
      },
    });
    const { caseId, approval } = prepareManagerReadyCase();
    repairStore.approveContractorCall(caseId, approval);

    agent.wake(caseId);
    await agent.idle();
    expect(repairStore.get(caseId)).toMatchObject({
      callApproval: { callsConsumed: 0 },
      repairAgent: {
        effects: [
          expect.anything(),
          expect.objectContaining({ type: "contractor_call", status: "retryable", attempts: 1 }),
        ],
      },
    });

    agent.wake(caseId);
    await agent.idle();
    expect(repairStore.get(caseId)).toMatchObject({
      callApproval: { callsConsumed: 1 },
      voiceCall: { providerId: "…888888" },
    });
    expect(starts).toBe(2);
  });

  it("quarantines an ambiguous call-start failure without redialing", async () => {
    let starts = 0;
    const agent = createRepairAgent({
      prepareManagerReview: async () => {
        throw new Error("No text-agent run expected.");
      },
      sendTenantText: async () => ({ delivery: "twilio", providerId: "SM-not-used" }),
      startContractorCall: async () => {
        starts += 1;
        throw new Error("Connection ended after dispatch.");
      },
    });
    const { caseId, approval } = prepareManagerReadyCase();
    repairStore.approveContractorCall(caseId, approval);

    agent.wake(caseId);
    await agent.idle();
    agent.wake(caseId);
    await agent.idle();

    expect(starts).toBe(1);
    expect(repairStore.get(caseId)).toMatchObject({
      callApproval: { callsConsumed: 0 },
      repairAgent: {
        effects: [
          expect.anything(),
          expect.objectContaining({ type: "contractor_call", status: "unknown", attempts: 1 }),
        ],
      },
    });
    expect(repairStore.get(caseId).voiceCall).toBeUndefined();
  });

  it("retries one unknown call record only after the manager records provider absence", async () => {
    const wakes: string[] = [];
    const { caseId, approval } = prepareManagerReadyCase();
    repairStore.approveContractorCall(caseId, approval);
    const effect = repairStore.claimAgentEffect(caseId)!;
    repairStore.failAgentEffect(caseId, effect.effectKey, "unknown");
    const { server, baseUrl } = await startServer(
      createApp({ scheduleAgentRun: (id) => wakes.push(id) }),
    );
    servers.push(server);

    const response = await fetch(`${baseUrl}/api/cases/${caseId}/effect-reconciliation`, {
      method: "POST",
      headers: {
        Authorization: managerAuthorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        effectKey: effect.effectKey,
        resolution: "absent",
        confirmation: "provider confirms no outbound effect was accepted; reconcile saved record",
      }),
    });

    expect(response.status).toBe(200);
    expect(repairStore.get(caseId).repairAgent?.effects).toContainEqual(
      expect.objectContaining({ effectKey: effect.effectKey, status: "retryable", attempts: 1 }),
    );
    expect(repairStore.get(caseId).manualContactTasks).toEqual([]);
    expect(wakes).toEqual([caseId]);
  });

  it("records a provider-created unknown call without authorizing a redial", () => {
    const callSid = "CA30303030303030303030303030303030";
    const { caseId, approval } = prepareManagerReadyCase();
    repairStore.approveContractorCall(caseId, approval);
    const effect = repairStore.claimAgentEffect(caseId)!;
    repairStore.failAgentEffect(caseId, effect.effectKey, "unknown");

    expect(() =>
      repairStore.reconcileOutboundEffect(caseId, effect.effectKey, "accepted", callSid),
    ).toThrow("current status");
    repairStore.reconcileOutboundEffect(
      caseId,
      effect.effectKey,
      "accepted",
      callSid,
      "in-progress",
    );

    const repair = repairStore.get(caseId);
    expect(repair).toMatchObject({
      callApproval: { callsConsumed: 1 },
      voiceCall: {
        providerId: "…303030",
        transportStatus: "in-progress",
      },
      repairAgent: {
        effects: [
          expect.anything(),
          expect.objectContaining({
            effectKey: effect.effectKey,
            status: "succeeded",
            attempts: 1,
          }),
        ],
      },
    });
    expect(repair.voiceCall?.outcome).toBeUndefined();
    expect(repairStore.claimAgentEffect(caseId)).toBeUndefined();
    expect(() => repairStore.resetControlledLive()).toThrow("active provider work");
  });

  it("closes a revoked unknown call after provider-confirmed absence", () => {
    const { caseId, approval } = prepareManagerReadyCase();
    repairStore.approveContractorCall(caseId, approval);
    const effect = repairStore.claimAgentEffect(caseId)!;
    repairStore.failAgentEffect(caseId, effect.effectKey, "unknown");
    repairStore.recordTenantAccessAuthorization(caseId, {
      sourceMessageId: approval.tenantAccessSourceMessageId,
      proposalId: approval.proposalId,
      timeWindow: "2026-09-01T14:15:00.000Z/2026-09-01T15:45:00.000Z",
    });

    repairStore.reconcileOutboundEffect(caseId, effect.effectKey, "absent");

    const repair = repairStore.get(caseId);
    expect(repair.callApproval).toBeUndefined();
    expect(repair).toMatchObject({
      repairAgent: {
        effects: [
          expect.anything(),
          expect.objectContaining({ effectKey: effect.effectKey, status: "superseded" }),
        ],
      },
    });
    expect(() => repairStore.resetControlledLive()).not.toThrow();
  });

  it("revokes booking authority without authorizing a second call when facts change", () => {
    const callSid = "CA16161616161616161616161616161616";
    const { caseId, approval } = prepareConsentedCall(callSid);

    const changed = repairStore.recordTenantAccessAuthorization(caseId, {
      sourceMessageId: approval.tenantAccessSourceMessageId,
      proposalId: approval.proposalId,
      timeWindow: "2026-09-01T14:15:00.000Z/2026-09-01T15:45:00.000Z",
    });
    repairStore.recordVoiceOutcome(callSid, "tool:stale-confirmation", {
      outcome: "confirmed",
      summary: "The contractor confirmed the stale timing authority.",
      finalTimeWindow: "2026-09-01T14:30:00.000Z/2026-09-01T15:30:00.000Z",
    });

    expect(repairStore.get(caseId)).toMatchObject({
      callApproval: {
        callsConsumed: 1,
        revokedAt: expect.any(String),
      },
      voiceCall: { outcome: "requested_change" },
      manualContactTasks: [expect.objectContaining({ status: "open" })],
    });
    expect(repairStore.get(caseId).appointment).toBeUndefined();
    expect(() =>
      repairStore.approveContractorCall(caseId, {
        ...approval,
        caseRevision: changed.repairAgent!.revision,
        tenantTimeWindow: changed.tenantAccessAuthorization!.timeWindow,
      }),
    ).toThrow("One contractor call is already approved");
  });

  it("rejects an OpenAI SIP leg when the approved facts changed after Press 1", async () => {
    const callSid = "CA20202020202020202020202020202020";
    const { caseId, approval } = prepareStartedCall(callSid);
    repairStore.recordVoiceDisclosure(callSid, "disclosure:revoked-before-openai");
    repairStore.recordVoiceConsent(callSid, "consent:revoked-before-openai", "granted");
    repairStore.claimVoiceSipBridge(callSid);
    repairStore.recordTenantAccessAuthorization(caseId, {
      sourceMessageId: approval.tenantAccessSourceMessageId,
      proposalId: approval.proposalId,
      timeWindow: "2026-09-01T14:15:00.000Z/2026-09-01T15:45:00.000Z",
    });
    const requests: string[] = [];
    const handler = createOpenAiVoiceHandler({
      env: process.env,
      unwrap: async () => ({
        id: "evt_revoked_incoming",
        type: "realtime.call.incoming",
        data: {
          call_id: "rtc_revoked_incoming",
          sip_headers: [{ name: "x-fix-this-call-sid", value: callSid }],
        },
      }),
      fetch: async (input) => {
        requests.push(String(input));
        return new Response("{}", { status: 200 });
      },
      createSocket: () => {
        throw new Error("A revoked call must not open an OpenAI socket.");
      },
      scheduleAgentRun: () => undefined,
    });

    await handler("{}", {});

    expect(requests).toEqual([
      "https://api.openai.com/v1/realtime/calls/rtc_revoked_incoming/reject",
    ]);
    expect(repairStore.get(caseId).voiceCall).toMatchObject({ openAiConnected: false });
  });

  it("keeps disclosure and Press 1 consent outside OpenAI", async () => {
    const callSid = "CA22222222222222222222222222222222";
    const agent = createRepairAgent({
      prepareManagerReview: async () => {
        throw new Error("No text-agent run expected.");
      },
      sendTenantText: async () => ({ delivery: "twilio", providerId: "SM-not-used" }),
      startContractorCall: async () => ({ providerId: callSid }),
    });
    const { caseId, approval } = prepareManagerReadyCase();
    const { server, baseUrl } = await startServer(createApp({ scheduleAgentRun: agent.wake }));
    servers.push(server);
    await fetch(`${baseUrl}/api/cases/${caseId}/call-approval`, {
      method: "POST",
      headers: {
        Authorization: managerAuthorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(approval),
    });
    await agent.idle();
    const providerBody = {
      AccountSid: accountSid,
      CallSid: callSid,
      From: servicePhone,
      To: contractorPhone,
    };

    const disclosure = await postTwilioVoice(baseUrl, "consent", providerBody);
    expect(disclosure.status).toBe(200);
    const disclosureXml = await disclosure.text();
    expect(disclosureXml).toMatch(/<Gather[\s\S]*Press 1[\s\S]*<\/Gather>/);
    expect(disclosureXml).not.toContain("sip.api.openai.com");

    const consent = await postTwilioVoice(baseUrl, "consent-result", {
      ...providerBody,
      Digits: "1",
    });
    expect(consent.status).toBe(200);
    const consentXml = await consent.text();
    expect(consentXml).toMatch(/<Dial[^>]*timeLimit="300"/);
    expect(consentXml).toMatch(/<Sip>sip:proj_test@sip\.api\.openai\.com/);
    expect(repairStore.get(caseId).voiceCall).toMatchObject({
      providerId: "…222222",
      disclosureServed: true,
      perCallConsent: "granted",
      openAiConnected: false,
    });
  });

  it("returns the same post-consent SIP bridge when Twilio retries", async () => {
    const callSid = "CA15151515151515151515151515151515";
    const { caseId } = prepareStartedCall(callSid);
    const { server, baseUrl } = await startServer(createApp());
    servers.push(server);
    const body = {
      AccountSid: accountSid,
      CallSid: callSid,
      From: servicePhone,
      To: contractorPhone,
    };
    await postTwilioVoice(baseUrl, "consent", body);

    const first = await postTwilioVoice(baseUrl, "consent-result", { ...body, Digits: "1" });
    const duplicate = await postTwilioVoice(baseUrl, "consent-result", {
      ...body,
      Digits: "1",
    });

    expect(await first.text()).toContain("sip.api.openai.com");
    expect(await duplicate.text()).toContain("sip.api.openai.com");
    expect(repairStore.get(caseId).voiceCall).toMatchObject({
      perCallConsent: "granted",
      sipBridgeOffered: true,
    });
  });

  it("rejects unsigned or misbound voice callbacks and an unsigned OpenAI webhook", async () => {
    const callSid = "CA13131313131313131313131313131313";
    const { caseId } = prepareStartedCall(callSid);
    const { server, baseUrl } = await startServer(createApp());
    servers.push(server);
    const body = {
      AccountSid: accountSid,
      CallSid: callSid,
      From: servicePhone,
      To: contractorPhone,
    };
    const unsigned = await fetch(`${baseUrl}/api/voice/twilio/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
    const wrongBinding = await postTwilioVoice(baseUrl, "consent", {
      ...body,
      To: "+14125559999",
    });
    const unsignedOpenAi = await fetch(`${baseUrl}/api/voice/openai/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(unsigned.status).toBe(403);
    expect(wrongBinding.status).toBe(403);
    expect(unsignedOpenAi.status).toBe(400);
    expect(repairStore.get(caseId).voiceCall).toMatchObject({
      disclosureServed: false,
      openAiConnected: false,
    });
  });

  it("binds a verified post-consent OpenAI tool outcome to the approved call", async () => {
    const callSid = "CA99999999999999999999999999999999";
    const finalTimeWindow = "2026-09-01T14:30:00.000Z/2026-09-01T15:30:00.000Z";
    const { caseId } = prepareStartedCall(callSid);
    repairStore.recordVoiceDisclosure(callSid, "disclosure:openai");
    repairStore.recordVoiceConsent(callSid, "consent:openai", "granted");
    repairStore.claimVoiceSipBridge(callSid);
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const sent: string[] = [];
    let closes = 0;
    const socket = {
      on(event: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(event, handler);
        return socket;
      },
      send(value: string) {
        sent.push(value);
      },
      close() {
        closes += 1;
      },
    };
    const requests: string[] = [];
    const requestBodies: string[] = [];
    const wakes: string[] = [];
    const handler = createOpenAiVoiceHandler({
      env: process.env,
      unwrap: async () => ({
        id: "evt_incoming_1",
        type: "realtime.call.incoming",
        data: {
          call_id: "rtc_openai_1",
          sip_headers: [{ name: "x-fix-this-call-sid", value: callSid }],
        },
      }),
      fetch: async (input, init) => {
        requests.push(String(input));
        if (init?.body) requestBodies.push(String(init.body));
        return new Response("{}", { status: 200 });
      },
      createSocket: () => socket,
      scheduleAgentRun: (id) => wakes.push(id),
    });

    await handler("{}", {});
    await handlers.get("open")?.();
    await handlers.get("message")?.(
      Buffer.from(
        JSON.stringify({
          event_id: "evt_transcript_1",
          type: "conversation.item.input_audio_transcription.completed",
          transcript: "I confirm that slot.",
        }),
      ),
    );
    await handlers.get("message")?.(
      Buffer.from(
        JSON.stringify({
          event_id: "evt_outcome_1",
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "report_call_outcome",
                call_id: "tool_call_1",
                arguments: JSON.stringify({
                  outcome: "confirmed",
                  summary: "The contractor accepted the exact terms.",
                  finalTimeWindow,
                }),
              },
            ],
          },
        }),
      ),
    );
    await handlers.get("message")?.(
      Buffer.from(
        JSON.stringify({
          event_id: "evt_goodbye_done_1",
          type: "response.done",
          response: { output: [] },
        }),
      ),
    );

    expect(requests).toEqual([
      "https://api.openai.com/v1/realtime/calls/rtc_openai_1/accept",
      "https://api.openai.com/v1/realtime/calls/rtc_openai_1/hangup",
    ]);
    expect(requestBodies[0]).toContain("$160.50");
    expect(JSON.parse(requestBodies[0]!)).toMatchObject({ parallel_tool_calls: false });
    expect(sent.some((value) => value.includes("response.create"))).toBe(true);
    expect(wakes).toEqual([caseId]);
    expect(closes).toBe(1);
    expect(repairStore.get(caseId)).toMatchObject({
      status: "scheduled",
      voiceCall: {
        openAiConnected: true,
        transcript: [expect.objectContaining({ party: "contractor", text: "I confirm that slot." })],
        outcome: "confirmed",
      },
      appointment: { timeWindow: finalTimeWindow },
    });
  });

  it("records a non-confirmed OpenAI outcome when its final window is omitted", async () => {
    const callSid = "CA27272727272727272727272727272727";
    const { caseId } = prepareStartedCall(callSid);
    repairStore.recordVoiceDisclosure(callSid, "disclosure:openai-omitted-window");
    repairStore.recordVoiceConsent(callSid, "consent:openai-omitted-window", "granted");
    repairStore.claimVoiceSipBridge(callSid);
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    let closes = 0;
    const socket = {
      on(event: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(event, handler);
        return socket;
      },
      send() {},
      close() {
        closes += 1;
      },
    };
    const handler = createOpenAiVoiceHandler({
      env: process.env,
      unwrap: async () => ({
        id: "evt_incoming_omitted_window",
        type: "realtime.call.incoming",
        data: {
          call_id: "rtc_openai_omitted_window",
          sip_headers: [{ name: "x-fix-this-call-sid", value: callSid }],
        },
      }),
      fetch: async () => new Response("{}", { status: 200 }),
      createSocket: () => socket,
      scheduleAgentRun: () => undefined,
    });

    await handler("{}", {});
    await handlers.get("message")?.(
      Buffer.from(
        JSON.stringify({
          event_id: "evt_outcome_omitted_window",
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "report_call_outcome",
                call_id: "tool_call_omitted_window",
                arguments: JSON.stringify({
                  outcome: "ambiguous",
                  summary: "The contractor did not confirm every approved term.",
                }),
              },
            ],
          },
        }),
      ),
    );

    expect(repairStore.get(caseId)).toMatchObject({
      voiceCall: { outcome: "ambiguous" },
    });
    expect(repairStore.get(caseId).appointment).toBeUndefined();
    expect(closes).toBe(1);
  });

  it("quarantines an ambiguous OpenAI acceptance without retrying it", async () => {
    const callSid = "CA17171717171717171717171717171717";
    const { caseId } = prepareStartedCall(callSid);
    repairStore.recordVoiceDisclosure(callSid, "disclosure:openai-failure");
    repairStore.recordVoiceConsent(callSid, "consent:openai-failure", "granted");
    repairStore.claimVoiceSipBridge(callSid);
    let requests = 0;
    const handler = createOpenAiVoiceHandler({
      env: process.env,
      unwrap: async () => ({
        id: "evt_incoming_failure",
        type: "realtime.call.incoming",
        data: {
          call_id: "rtc_openai_failure",
          sip_headers: [{ name: "x-fix-this-call-sid", value: callSid }],
        },
      }),
      fetch: async () => {
        requests += 1;
        throw new Error("Connection ended after dispatch.");
      },
      createSocket: () => {
        throw new Error("No socket should open.");
      },
      scheduleAgentRun: () => undefined,
    });

    await expect(handler("{}", {})).rejects.toThrow("Connection error");
    await handler("{}", {});

    expect(requests).toBe(2);
    expect(repairStore.get(caseId)).toMatchObject({
      voiceCall: { openAiConnected: false, openAiConnectionStatus: "unknown" },
      manualContactTasks: [expect.objectContaining({ status: "open" })],
    });
    expect(repairStore.get(caseId).appointment).toBeUndefined();
  });

  it("recovers an interrupted OpenAI acceptance as unknown without replaying it", () => {
    const callSid = "CA18181818181818181818181818181818";
    const { caseId } = prepareStartedCall(callSid);
    repairStore.recordVoiceDisclosure(callSid, "disclosure:openai-recovery");
    repairStore.recordVoiceConsent(callSid, "consent:openai-recovery", "granted");
    repairStore.claimVoiceSipBridge(callSid);
    repairStore.claimOpenAiVoiceConnection(callSid, "openai:accepting");

    repairStore.recoverAgentWork();

    expect(repairStore.get(caseId)).toMatchObject({
      voiceCall: { openAiConnectionStatus: "unknown", openAiConnected: false },
      manualContactTasks: [expect.objectContaining({ status: "open" })],
    });
  });

  it("blocks reset and recovers a connected OpenAI call after provisional completion", () => {
    const callSid = "CA24242424242424242424242424242424";
    const { caseId } = prepareConsentedCall(callSid);
    repairStore.recordVoiceTransport(callSid, "status:provisional-before-recovery", "completed", 3);

    expect(() => repairStore.resetControlledLive()).toThrow("active provider work");

    repairStore.recoverAgentWork();

    expect(repairStore.get(caseId)).toMatchObject({
      voiceCall: {
        openAiConnectionStatus: "unknown",
        openAiConnected: false,
        outcome: "needs_manual_follow_up",
        outcomeProvisional: true,
      },
      manualContactTasks: [expect.objectContaining({ status: "open" })],
    });
  });

  it.each([
    { digits: "2", consent: "declined" },
    { digits: undefined, consent: "timed_out" },
    { digits: "3", consent: "timed_out" },
  ] as const)("creates one manual task when consent is $consent", async ({ digits, consent }) => {
    const callSid = consent === "declined"
      ? "CA44444444444444444444444444444444"
      : "CA55555555555555555555555555555555";
    const { caseId } = prepareStartedCall(callSid);
    const { server, baseUrl } = await startServer(createApp());
    servers.push(server);
    const providerBody = {
      AccountSid: accountSid,
      CallSid: callSid,
      From: servicePhone,
      To: contractorPhone,
    };
    await postTwilioVoice(baseUrl, "consent", providerBody);
    const consentBody = digits ? { ...providerBody, Digits: digits } : providerBody;

    const first = await postTwilioVoice(baseUrl, "consent-result", consentBody);
    const duplicate = await postTwilioVoice(baseUrl, "consent-result", consentBody);

    expect(first.status).toBe(200);
    expect(await first.text()).toContain("No audio was sent to the AI");
    expect(duplicate.status).toBe(200);
    expect(repairStore.get(caseId)).toMatchObject({
      voiceCall: { perCallConsent: consent, openAiConnected: false },
      manualContactTasks: [expect.objectContaining({ status: "open" })],
    });
    expect(repairStore.get(caseId).contractorConfirmation).toBeUndefined();
    expect(repairStore.get(caseId).appointment).toBeUndefined();
  });

  it.each([
    { status: "busy", outcome: "unreachable" },
    { status: "failed", outcome: "failed" },
  ] as const)("creates one manual task when Twilio reports $status", async ({ status, outcome }) => {
    const callSid = status === "busy"
      ? "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      : "CAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const { caseId } = prepareStartedCall(callSid);
    const { server, baseUrl } = await startServer(createApp());
    servers.push(server);
    const body = {
      AccountSid: accountSid,
      CallSid: callSid,
      From: servicePhone,
      To: contractorPhone,
      CallStatus: status,
    };

    const first = await postTwilioVoice(baseUrl, "status", body);
    const duplicate = await postTwilioVoice(baseUrl, "status", body);

    expect(first.status).toBe(204);
    expect(duplicate.status).toBe(204);
    expect(repairStore.get(caseId)).toMatchObject({
      voiceCall: { transportStatus: status, outcome },
      manualContactTasks: [expect.objectContaining({ status: "open" })],
    });
    expect(repairStore.get(caseId).appointment).toBeUndefined();
  });

  it("keeps the newest Twilio status and makes completed provisional", async () => {
    const callSid = "CA25252525252525252525252525252525";
    const { caseId } = prepareStartedCall(callSid);
    const { server, baseUrl } = await startServer(createApp());
    servers.push(server);
    const baseBody = {
      AccountSid: accountSid,
      CallSid: callSid,
      From: servicePhone,
      To: contractorPhone,
    };

    await postTwilioVoice(baseUrl, "status", {
      ...baseBody,
      CallStatus: "completed",
      SequenceNumber: "3",
    });
    await postTwilioVoice(baseUrl, "status", {
      ...baseBody,
      CallStatus: "ringing",
      SequenceNumber: "1",
    });

    expect(repairStore.get(caseId)).toMatchObject({
      voiceCall: {
        transportStatus: "completed",
        transportSequence: 3,
        outcome: "no_consent_response",
        outcomeProvisional: true,
      },
      manualContactTasks: [expect.objectContaining({ status: "open" })],
    });
  });

  it("lets a verified OpenAI outcome replace a provisional call-end fallback", async () => {
    const callSid = "CA26262626262626262626262626262626";
    const finalTimeWindow = "2026-09-01T14:30:00.000Z/2026-09-01T15:30:00.000Z";
    const { caseId } = prepareConsentedCall(callSid);
    repairStore.recordVoiceFailure(
      callSid,
      "sip-complete-before-tool",
      "The consented call ended without a contractor outcome.",
      true,
    );

    repairStore.recordVoiceOutcome(callSid, "tool:after-sip-complete", {
      outcome: "confirmed",
      summary: "The contractor accepted the exact terms.",
      finalTimeWindow,
    });
    const { server, baseUrl } = await startServer(createApp());
    servers.push(server);
    const sipComplete = await postTwilioVoice(baseUrl, "sip-complete", {
      AccountSid: accountSid,
      CallSid: callSid,
      From: servicePhone,
      To: contractorPhone,
    });
    const closure = await sipComplete.text();

    expect(repairStore.get(caseId)).toMatchObject({
      status: "scheduled",
      voiceCall: { outcome: "confirmed" },
      appointment: { timeWindow: finalTimeWindow },
      manualContactTasks: [],
    });
    expect(closure).toContain("The approved terms were recorded");
    expect(closure).not.toContain("No audio was sent to the AI");
  });

  it("uses truthful fallback copy after a post-consent outcome cannot book", async () => {
    const callSid = "CA34343434343434343434343434343434";
    const { caseId } = prepareConsentedCall(callSid);
    repairStore.recordVoiceOutcome(callSid, "tool:post-consent-change", {
      outcome: "requested_change",
      summary: "The contractor requested different terms.",
    });
    const { server, baseUrl } = await startServer(createApp());
    servers.push(server);

    const response = await postTwilioVoice(baseUrl, "sip-complete", {
      AccountSid: accountSid,
      CallSid: callSid,
      From: servicePhone,
      To: contractorPhone,
    });
    const closure = await response.text();

    expect(repairStore.get(caseId).voiceCall?.outcome).toBe("requested_change");
    expect(closure).toContain("The automated confirmation could not be verified");
    expect(closure).not.toContain("No audio was sent to the AI");
  });

  it("books one in-bounds confirmed slot and sends one tenant confirmation", async () => {
    const sends: string[] = [];
    const agent = createRepairAgent({
      prepareManagerReview: async () => {
        throw new Error("No text-agent run expected.");
      },
      sendTenantText: async (body) => {
        sends.push(body);
        return { delivery: "twilio", providerId: "SM33333333333333333333333333333333" };
      },
    });
    const callSid = "CA33333333333333333333333333333333";
    const finalTimeWindow = "2026-09-01T14:30:00.000Z/2026-09-01T15:30:00.000Z";
    const { caseId } = prepareConsentedCall(callSid);

    const first = repairStore.recordVoiceOutcome(callSid, "tool:confirmed:1", {
      outcome: "confirmed",
      summary: "The contractor accepted the exact stored price and final visit slot.",
      finalTimeWindow,
    });
    expect(first).toMatchObject({ duplicate: false, shouldWake: true });
    agent.wake(caseId);
    await agent.idle();
    const duplicate = repairStore.recordVoiceOutcome(callSid, "tool:confirmed:1", {
      outcome: "confirmed",
      summary: "The contractor accepted the exact stored price and final visit slot.",
      finalTimeWindow,
    });

    const repair = repairStore.get(caseId);
    expect(duplicate).toMatchObject({ duplicate: true, shouldWake: false });
    expect(repair).toMatchObject({
      status: "scheduled",
      appointment: { timeWindow: finalTimeWindow, notificationId: expect.any(String) },
      contractorConfirmation: {
        source: "consented_voice",
        contractorAlias: "contractor",
        proposalId: repair.proposal?.id,
        timeWindow: finalTimeWindow,
      },
      voiceCall: { outcome: "confirmed" },
    });
    expect(sends).toEqual([
      `Your repair visit is booked with Approved contractor for ${finalTimeWindow}.`,
    ]);
    expect(
      repair.repairAgent?.effects.filter(
        (effect) => effect.type === "tenant_sms" && effect.purpose === "booking_confirmation",
      ),
    ).toEqual([expect.objectContaining({ status: "succeeded", attempts: 1 })]);
  });

  it("retries one saved booking confirmation after known provider rejection", async () => {
    let sends = 0;
    const agent = createRepairAgent({
      prepareManagerReview: async () => {
        throw new Error("No text-agent run expected.");
      },
      sendTenantText: async () => {
        sends += 1;
        if (sends < 3) throw new KnownTextDeliveryFailure("Twilio rejected the message.");
        return { delivery: "twilio", providerId: "SM31313131313131313131313131313131" };
      },
      waitBeforeRetry: async () => undefined,
    });
    const callSid = "CA31313131313131313131313131313131";
    const finalTimeWindow = "2026-09-01T14:30:00.000Z/2026-09-01T15:30:00.000Z";
    const { caseId } = prepareConsentedCall(callSid);
    repairStore.recordVoiceOutcome(callSid, "tool:booking-retry", {
      outcome: "confirmed",
      summary: "The contractor accepted the exact terms.",
      finalTimeWindow,
    });

    agent.wake(caseId);
    await agent.idle();

    expect(sends).toBe(3);
    expect(repairStore.get(caseId)).toMatchObject({
      appointment: { notificationId: expect.any(String) },
      repairAgent: {
        effects: [
          expect.anything(),
          expect.anything(),
          expect.objectContaining({
            purpose: "booking_confirmation",
            status: "succeeded",
            attempts: 3,
          }),
        ],
      },
    });
  });

  it.each([
    { resolution: "accepted", status: "succeeded", notificationRecorded: true },
    { resolution: "absent", status: "retryable", notificationRecorded: false },
  ] as const)(
    "reconciles an unknown booking text as provider $resolution",
    ({ resolution, status, notificationRecorded }) => {
      const callSid = resolution === "accepted"
        ? "CA32323232323232323232323232323232"
        : "CA33333333333333333333333333333334";
      const finalTimeWindow = "2026-09-01T14:30:00.000Z/2026-09-01T15:30:00.000Z";
      const { caseId } = prepareConsentedCall(callSid);
      repairStore.recordVoiceOutcome(callSid, `tool:booking-${resolution}`, {
        outcome: "confirmed",
        summary: "The contractor accepted the exact terms.",
        finalTimeWindow,
      });
      const before = repairStore.outbox().length;
      const effect = repairStore.claimAgentEffect(caseId)!;
      repairStore.failAgentEffect(caseId, effect.effectKey, "unknown");

      repairStore.reconcileOutboundEffect(caseId, effect.effectKey, resolution);

      const repair = repairStore.get(caseId);
      expect(repair.repairAgent?.effects).toContainEqual(
        expect.objectContaining({ effectKey: effect.effectKey, status, attempts: 1 }),
      );
      expect(Boolean(repair.appointment?.notificationId)).toBe(notificationRecorded);
      expect(repairStore.outbox()).toHaveLength(before + (notificationRecorded ? 1 : 0));
      expect(repair.manualContactTasks).toEqual([]);
    },
  );

  it.each([
    { outcome: "declined", finalTimeWindow: undefined, recorded: "declined" },
    { outcome: "requested_change", finalTimeWindow: undefined, recorded: "requested_change" },
    { outcome: "ambiguous", finalTimeWindow: undefined, recorded: "ambiguous" },
    {
      outcome: "confirmed",
      finalTimeWindow: "2026-09-01T16:30:00.000Z/2026-09-01T17:30:00.000Z",
      recorded: "requested_change",
    },
  ] as const)(
    "requires manual follow-up for a $outcome result that cannot book",
    ({ outcome, finalTimeWindow, recorded }) => {
      const callSid = `CA${outcome.padEnd(32, "0").slice(0, 32)}`;
      const { caseId } = prepareConsentedCall(callSid);

      repairStore.recordVoiceOutcome(callSid, `tool:${outcome}`, {
        outcome,
        summary: "The contractor did not accept a slot inside the exact authority.",
        finalTimeWindow,
      });

      const repair = repairStore.get(caseId);
      expect(repair.voiceCall?.outcome).toBe(recorded);
      expect(repair.manualContactTasks).toHaveLength(1);
      expect(repair.contractorConfirmation).toBeUndefined();
      expect(repair.appointment).toBeUndefined();
    },
  );

  it("deletes the transcript immediately when consent is withdrawn", () => {
    const callSid = "CA66666666666666666666666666666666";
    const { caseId } = prepareConsentedCall(callSid);
    repairStore.appendVoiceTranscript(callSid, "transcript:1", "contractor", "I can attend.");
    repairStore.appendVoiceTranscript(callSid, "transcript:2", "agent", "Please confirm.");

    repairStore.recordVoiceOutcome(callSid, "tool:withdrawal", {
      outcome: "consent_withdrawn",
      summary: "Do not process this call further.",
    });

    expect(repairStore.get(caseId)).toMatchObject({
      voiceCall: {
        outcome: "consent_withdrawn",
        perCallConsent: "withdrawn",
        transcript: [],
        transcriptDeletedAt: expect.any(String),
      },
      manualContactTasks: [expect.objectContaining({ status: "open" })],
    });
    expect(repairStore.get(caseId).voiceCall?.outcomeSummary).toBeUndefined();
  });

  it("bounds transcript entries and aggregate storage for one controlled call", () => {
    const callSid = "CA27272727272727272727272727272727";
    prepareConsentedCall(callSid);

    expect(() =>
      repairStore.appendVoiceTranscript(callSid, "transcript:oversized", "contractor", "x".repeat(2_001)),
    ).toThrow("storage limit");
    for (let index = 0; index < 33; index += 1) {
      repairStore.appendVoiceTranscript(
        callSid,
        `transcript:bounded:${index}`,
        "contractor",
        "x".repeat(1_900),
      );
    }
    expect(() =>
      repairStore.appendVoiceTranscript(
        callSid,
        "transcript:aggregate-overflow",
        "contractor",
        "x".repeat(1_900),
      ),
    ).toThrow("storage limit");
  });

  it("preserves tenant STOP and SMS replay keys across controlled reset", () => {
    repairStore.receiveVerifiedSms({
      sourceKey: "sms:stop-before-reset",
      body: "STOP",
      preference: "STOP",
    });

    const reset = repairStore.resetControlledLive();
    const next = repairStore.receiveVerifiedSms({
      sourceKey: "sms:new-after-reset",
      body: "This must remain manual.",
    });

    expect(reset.controlledLive).toMatchObject({
      tenantMessagingStoppedAt: expect.any(String),
      handledSmsEvents: expect.arrayContaining(["sms:stop-before-reset"]),
    });
    expect(next).toMatchObject({
      shouldWake: false,
      repair: { repairAgent: { tenantMessaging: "stopped", phase: "stopped" } },
    });
    expect(() =>
      repairStore.receiveVerifiedSms({
        sourceKey: "sms:stop-before-reset",
        body: "STOP",
        preference: "STOP",
      }),
    ).toThrow("already handled before controlled reset");
  });

  it("deletes case content on controlled reset while preserving withdrawal and replay keys", () => {
    const callSid = "CA77777777777777777777777777777777";
    prepareConsentedCall(callSid);
    repairStore.appendVoiceTranscript(callSid, "transcript:reset", "contractor", "Private words.");
    repairStore.recordVoiceOutcome(callSid, "tool:reset-withdrawal", {
      outcome: "consent_withdrawn",
      summary: "Withdraw consent.",
    });
    repairStore.recordVoiceTransport(callSid, "status:reset-withdrawal", "completed", 99);

    const reset = repairStore.resetControlledLive();

    expect(reset.cases).toEqual([]);
    expect(JSON.stringify(reset)).not.toContain("Private words");
    expect(reset.controlledLive).toMatchObject({
      voiceEnrollmentWithdrawnAt: expect.any(String),
      handledVoiceCallbacks: expect.arrayContaining(["tool:reset-withdrawal"]),
    });
    const { caseId, approval } = prepareManagerReadyCase("tenant-emergency-after-reset");
    expect(() => repairStore.approveContractorCall(caseId, approval)).toThrow(
      "Contractor voice enrollment was withdrawn",
    );
  });

  it("deletes a retained post-consent transcript on controlled reset", () => {
    const callSid = "CA19191919191919191919191919191919";
    prepareConsentedCall(callSid);
    repairStore.appendVoiceTranscript(
      callSid,
      "transcript:reset-without-withdrawal",
      "contractor",
      "Reset-only private words.",
    );
    repairStore.recordVoiceOutcome(callSid, "tool:ambiguous-before-reset", {
      outcome: "ambiguous",
      summary: "No reliable confirmation was obtained.",
    });
    repairStore.recordVoiceTransport(callSid, "status:ambiguous-before-reset", "completed", 99);

    const reset = repairStore.resetControlledLive();

    expect(reset.cases).toEqual([]);
    expect(JSON.stringify(reset)).not.toContain("Reset-only private words");
    expect(reset.controlledLive?.handledVoiceCallbacks).toEqual(
      expect.arrayContaining([
        "transcript:reset-without-withdrawal",
        "tool:ambiguous-before-reset",
      ]),
    );
  });

  it("acknowledges any delayed callback for a retired call after controlled reset", async () => {
    const callSid = "CA21212121212121212121212121212121";
    const { caseId } = prepareConsentedCall(callSid);
    const approvedCallId = repairStore.get(caseId).callApproval!.id;
    repairStore.recordVoiceOutcome(callSid, "tool:terminal-before-reset", {
      outcome: "ambiguous",
      summary: "No reliable confirmation was obtained.",
    });
    const { server, baseUrl } = await startServer(createApp());
    servers.push(server);
    const body = {
      AccountSid: accountSid,
      CallSid: callSid,
      From: servicePhone,
      To: contractorPhone,
      CallStatus: "completed",
      SequenceNumber: "3",
    };
    expect((await postTwilioVoice(baseUrl, "status", body, approvedCallId)).status).toBe(204);
    repairStore.resetControlledLive();

    expect(
      (
        await postTwilioVoice(
          baseUrl,
          "status",
          { ...body, CallStatus: "ringing", SequenceNumber: "1" },
          approvedCallId,
        )
      ).status,
    ).toBe(204);
    expect(repairStore.list()).toEqual([]);
  });

  it("does not unwind a booked visit when the tenant sends a later update", async () => {
    const callSid = "CA22222222222222222222222222222223";
    const finalTimeWindow = "2026-09-01T14:30:00.000Z/2026-09-01T15:30:00.000Z";
    const { caseId } = prepareConsentedCall(callSid);
    repairStore.recordVoiceOutcome(callSid, "tool:book-before-update", {
      outcome: "confirmed",
      summary: "The contractor accepted the exact terms.",
      finalTimeWindow,
    });
    const effect = repairStore.claimAgentEffect(caseId)!;
    repairStore.completeAgentEffect(caseId, effect.effectKey, {
      delivery: "twilio",
      providerId: "SM22222222222222222222222222222223",
    });

    const { repair } = repairStore.receiveVerifiedSms({
      sourceKey: "tenant-update-after-booking",
      body: "Thank you, I saw the confirmation.",
    });

    expect(repair).toMatchObject({
      status: "scheduled",
      appointment: { timeWindow: finalTimeWindow, notificationId: expect.any(String) },
      contractorConfirmation: { source: "consented_voice", timeWindow: finalTimeWindow },
      callApproval: { callsConsumed: 1 },
    });
    expect(() =>
      repairStore.proposePreferred(caseId, {
        agreementId: "controlled-live-agreement",
        timeWindow: managerTimeWindow,
        reason: "A booked case must not be replaced.",
      }),
    ).toThrow("finished repair");
  });

  it("requires manager authentication and an explicit phrase for controlled reset", async () => {
    const callSid = "CA14141414141414141414141414141414";
    prepareStartedCall(callSid);
    repairStore.recordVoiceDisclosure(callSid, "disclosure:reset-route");
    repairStore.recordVoiceConsent(callSid, "consent:reset-route", "declined");
    const { server, baseUrl } = await startServer(createApp());
    servers.push(server);
    const request = (authorization: string | undefined, confirmation: string) =>
      fetch(`${baseUrl}/api/controlled-live/reset`, {
        method: "POST",
        headers: {
          ...(authorization ? { Authorization: authorization } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirmation }),
      });
    const formRequest = () =>
      fetch(`${baseUrl}/api/controlled-live/reset`, {
        method: "POST",
        headers: {
          Authorization: managerAuthorization,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ confirmation: "delete controlled-live case content" }),
      });

    expect((await request(undefined, "delete controlled-live case content")).status).toBe(401);
    expect((await request(managerAuthorization, "reset")).status).toBe(400);
    expect((await formRequest()).status).toBe(415);
    expect((await request(managerAuthorization, "delete controlled-live case content")).status).toBe(409);
    repairStore.recordVoiceTransport(callSid, "status:reset-route", "completed", 99);
    const reset = await request(managerAuthorization, "delete controlled-live case content");
    expect(reset.status).toBe(200);
    expect(reset.headers.get("cache-control")).toBe("private, no-store");
    expect(repairStore.list()).toEqual([]);
  });
});
