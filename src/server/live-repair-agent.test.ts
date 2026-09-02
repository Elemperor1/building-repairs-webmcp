import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import twilio from "twilio";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createTwilioPhotoDownloader } from "./photo-evidence.js";
import {
  KnownTextDeliveryFailure,
  createOpenAIRepairAgentModel,
  createRepairAgent,
  type RepairAgentDecision,
} from "./repair-agent.js";
import { repairStore } from "./store.js";

const publicBaseUrl = "https://live.fix-this.test";
const accountSid = "AC11111111111111111111111111111111";
const authToken = "test-auth-token";
const tenantPhone = "+14125550101";
const servicePhone = "+14125550102";
const contractorPhone = "+14125550103";
const managerPassword = "test-manager-password-that-is-long";
const managerAuthorization = `Basic ${Buffer.from(`manager:${managerPassword}`).toString("base64")}`;

const decision = (tenantReply = "Thanks. I recorded this for the property manager."): RepairAgentDecision => ({
  nextStep: "manager_review",
  title: "Water leak needs review",
  summary: "The tenant reported a water leak near an electrical fitting.",
  severity: "urgent",
  trade: "plumbing",
  tenantReply,
  managerReason: "Review the safety evidence and prepare the approved contractor action.",
});

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

const waitFor = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for the background repair agent.");
};

const webhookBody = (overrides: Record<string, string> = {}) => ({
  AccountSid: accountSid,
  MessageSid: "SM11111111111111111111111111111111",
  From: tenantPhone,
  To: servicePhone,
  Body: "Water is dripping near the bathroom light.",
  ...overrides,
});

const postWebhook = async (
  baseUrl: string,
  body = webhookBody(),
  signature = twilio.getExpectedTwilioSignature(
    authToken,
    `${publicBaseUrl}/api/sms/inbound`,
    body,
  ),
) =>
  fetch(`${baseUrl}/api/sms/inbound`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": signature,
    },
    body: new URLSearchParams(body),
  });

describe("controlled live SMS wake and repair-agent loop", () => {
  const servers: Server[] = [];

  beforeEach(() => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("CONTROLLED_LIVE_MODE", "true");
    vi.stubEnv("PUBLIC_BASE_URL", publicBaseUrl);
    vi.stubEnv("TWILIO_ACCOUNT_SID", accountSid);
    vi.stubEnv("TWILIO_AUTH_TOKEN", authToken);
    vi.stubEnv("TWILIO_PHONE_NUMBER", servicePhone);
    vi.stubEnv("CONTROLLED_LIVE_TENANT_PHONE", tenantPhone);
    vi.stubEnv("CONTROLLED_LIVE_CONTRACTOR_PHONE", contractorPhone);
    vi.stubEnv("CONTROLLED_LIVE_MANAGER_PASSWORD", managerPassword);
    vi.stubEnv("CONTROLLED_LIVE_AGREEMENT_PRICE_CENTS", "16000");
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
    vi.unstubAllGlobals();
  });

  it("rejects an invalid signature or the wrong account, sender, or destination", async () => {
    const wakes: string[] = [];
    const { server, baseUrl } = await startServer(
      createApp({ scheduleAgentRun: (caseId) => wakes.push(caseId) }),
    );
    servers.push(server);

    expect((await postWebhook(baseUrl, webhookBody(), "invalid")).status).toBe(403);

    for (const body of [
      webhookBody({ AccountSid: "AC22222222222222222222222222222222" }),
      webhookBody({ From: "+14125559999" }),
      webhookBody({ To: "+14125558888" }),
    ]) {
      expect((await postWebhook(baseUrl, body)).status).toBe(403);
    }

    expect(
      (
        await postWebhook(
          baseUrl,
          webhookBody({
            NumMedia: "1",
            MediaUrl0: "https://example.com/private-photo.jpg",
            MediaContentType0: "image/jpeg",
          }),
        )
      ).status,
    ).toBe(400);

    expect(repairStore.list()).toHaveLength(0);
    expect(wakes).toEqual([]);
  });

  it("records STOP, START, and HELP without waking or replying outside active consent", async () => {
    const wakes: string[] = [];
    const { server, baseUrl } = await startServer(
      createApp({ scheduleAgentRun: (caseId) => wakes.push(caseId) }),
    );
    servers.push(server);

    const send = (MessageSid: string, Body: string, OptOutType?: "STOP" | "START" | "HELP") =>
      postWebhook(baseUrl, webhookBody({ MessageSid, Body, ...(OptOutType ? { OptOutType } : {}) }));

    await send("SM10000000000000000000000000000000", "Water is entering the hallway.");
    const caseId = repairStore.list()[0]!.id;
    const run = repairStore.startAgentRun(caseId)!;
    expect(repairStore.commitAgentDecision(caseId, run.runId, decision())).toBe(true);

    expect(await (await send("SM10000000000000000000000000000001", "Stop", "STOP")).text()).toBe(
      "<Response></Response>",
    );
    expect(repairStore.list()[0]?.repairAgent).toMatchObject({
      tenantMessaging: "stopped",
      phase: "stopped",
    });

    await send("SM10000000000000000000000000000002", "Help", "HELP");
    await send("SM10000000000000000000000000000003", "The leak is worse.");
    await send("SM10000000000000000000000000000004", "Start", "START");
    await send("SM10000000000000000000000000000005", "The leak is still active.");

    const [repair] = repairStore.list();
    expect(wakes).toEqual([repair.id, repair.id]);
    expect(repair.repairAgent).toMatchObject({
      tenantMessaging: "active",
      events: [
        { status: "handled" },
        { status: "handled" },
        { status: "handled" },
        { status: "handled" },
        { status: "handled" },
        { status: "pending" },
      ],
      effects: [{ status: "superseded", attempts: 0 }],
    });
    expect(repair.activity.map(({ label }) => label)).toEqual(
      expect.arrayContaining([
        "Tenant stopped automated texts",
        "Manual contact required",
        "Tenant requested messaging help",
        "Tenant text received while automated replies are stopped",
        "Tenant restarted automated texts",
      ]),
    );
  });

  it("keeps an uncertain in-flight reply quarantined when STOP arrives", async () => {
    let rejectDelivery!: (error: Error) => void;
    const agent = createRepairAgent({
      prepareManagerReview: async () => decision(),
      sendTenantText: () =>
        new Promise<never>((_resolve, reject) => {
          rejectDelivery = reject;
        }),
    });
    const { server, baseUrl } = await startServer(createApp({ scheduleAgentRun: agent.wake }));
    servers.push(server);

    await postWebhook(baseUrl);
    await waitFor(
      () => repairStore.list()[0]?.repairAgent?.effects[0]?.status === "dispatching",
    );
    await postWebhook(
      baseUrl,
      webhookBody({
        MessageSid: "SM30000000000000000000000000000003",
        Body: "STOP",
        OptOutType: "STOP",
      }),
    );
    rejectDelivery(new Error("Connection ended after dispatch."));
    await agent.idle();

    expect(repairStore.list()[0]?.repairAgent).toMatchObject({
      tenantMessaging: "stopped",
      phase: "stopped",
      effects: [{ status: "unknown", attempts: 1 }],
    });
  });

  it("requires photo evidence before a non-emergency repair reaches manager review", async () => {
    const delivered: string[] = [];
    const agent = createRepairAgent({
      prepareManagerReview: async () => ({
        ...decision("Is the water still running?"),
        nextStep: "ask_tenant",
      }),
      sendTenantText: async (body) => {
        delivered.push(body);
        return { delivery: "local_outbox", providerId: "local-photo-request" };
      },
    });
    const { server, baseUrl } = await startServer(createApp({ scheduleAgentRun: agent.wake }));
    servers.push(server);

    await postWebhook(baseUrl);
    await agent.idle();

    expect(repairStore.list()[0]).toMatchObject({
      repairAgent: { phase: "waiting_for_tenant" },
    });
    expect(delivered).toEqual([expect.stringMatching(/photo.*water still running/is)]);
  });

  it("acknowledges signed MMS before privately validating the photo for manager review", async () => {
    const mediaSid = `ME${"a".repeat(32)}`;
    const messageSid = "SM11111111111111111111111111111111";
    const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}/Media/${mediaSid}`;
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);
    let releaseDownload!: () => void;
    const mediaFetch = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          releaseDownload = () =>
            resolve(
              new Response(jpeg, {
                status: 200,
                headers: {
                  "Content-Type": "image/jpeg",
                  "Content-Length": String(jpeg.byteLength),
                },
              }),
            );
        }),
    );
    const model = vi.fn(async (input: { photos: Array<{ contentType: string; dataBase64: string }> }) => {
      expect(input.photos).toEqual([
        { contentType: "image/jpeg", dataBase64: jpeg.toString("base64") },
      ]);
      return decision();
    });
    const delivered: string[] = [];
    const agent = createRepairAgent({
      downloadPhotoEvidence: createTwilioPhotoDownloader({
        fetch: mediaFetch as typeof fetch,
      }),
      prepareManagerReview: model,
      sendTenantText: async (body) => {
        delivered.push(body);
        return { delivery: "local_outbox", providerId: "local-photo-reviewed" };
      },
    });
    const { server, baseUrl } = await startServer(createApp({ scheduleAgentRun: agent.wake }));
    servers.push(server);

    const response = await postWebhook(
      baseUrl,
      webhookBody({
        Body: "Here is the photo you requested.",
        NumMedia: "1",
        MediaUrl0: mediaUrl,
        MediaContentType0: "image/jpeg",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<Response></Response>");
    await waitFor(() => mediaFetch.mock.calls.length === 1);
    expect(model).not.toHaveBeenCalled();

    const mediaRequest = mediaFetch.mock.calls[0]![1];
    expect(mediaRequest?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
    });
    releaseDownload();
    await agent.idle();

    const visible = await fetch(`${baseUrl}/api/cases/controlled-live-repair`, {
      headers: { Authorization: managerAuthorization },
    }).then((result) => result.json());
    expect(visible).toMatchObject({
      repair: {
        photoEvidence: [expect.objectContaining({ status: "available", contentType: "image/jpeg" })],
        repairAgent: { phase: "waiting_for_manager" },
      },
    });
    expect(visible.repair.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ channel: "mms" })]),
    );
    expect(delivered).toEqual(["Thanks. I recorded this for the property manager."]);
    expect(JSON.stringify(visible)).not.toContain(mediaUrl);
    expect(JSON.stringify(visible)).not.toContain(mediaSid);
    expect(JSON.stringify(visible)).not.toContain(jpeg.toString("base64"));
  });

  it("rejects disguised image bytes and keeps the photo gate closed without duplicate evidence", async () => {
    const mediaSid = `ME${"c".repeat(32)}`;
    const messageSid = "SM44444444444444444444444444444444";
    const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}/Media/${mediaSid}`;
    const mediaFetch = vi.fn(async () =>
      new Response("not a jpeg", {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      }),
    );
    const delivered: string[] = [];
    const agent = createRepairAgent({
      downloadPhotoEvidence: createTwilioPhotoDownloader({ fetch: mediaFetch as typeof fetch }),
      prepareManagerReview: async () => decision(),
      sendTenantText: async (body) => {
        delivered.push(body);
        return { delivery: "local_outbox", providerId: "local-invalid-photo" };
      },
    });
    const { server, baseUrl } = await startServer(createApp({ scheduleAgentRun: agent.wake }));
    servers.push(server);
    const body = webhookBody({
      MessageSid: messageSid,
      Body: "Photo attached.",
      NumMedia: "1",
      MediaUrl0: mediaUrl,
      MediaContentType0: "image/jpeg",
    });

    expect((await postWebhook(baseUrl, body)).status).toBe(200);
    await agent.idle();
    expect((await postWebhook(baseUrl, body)).status).toBe(200);
    await agent.idle();

    const [repair] = repairStore.list();
    expect(repair).toMatchObject({
      photoEvidence: [expect.objectContaining({ status: "rejected" })],
      repairAgent: { phase: "waiting_for_tenant" },
    });
    expect(mediaFetch).toHaveBeenCalledTimes(1);
    expect(delivered).toEqual([expect.stringMatching(/photo/i)]);
  });

  it("keeps a failed photo download durable and completes it on a later wake", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
    let downloadAttempt = 0;
    const delivered: string[] = [];
    const agent = createRepairAgent({
      downloadPhotoEvidence: async () => {
        downloadAttempt += 1;
        if (downloadAttempt === 1) throw new Error("Temporary media failure.");
        return { contentType: "image/jpeg", dataBase64: jpeg.toString("base64") };
      },
      prepareManagerReview: async () => decision(),
      sendTenantText: async (body) => {
        delivered.push(body);
        return { delivery: "local_outbox", providerId: "local-recovered-photo" };
      },
    });
    const { server, baseUrl } = await startServer(createApp({ scheduleAgentRun: agent.wake }));
    servers.push(server);
    const messageSid = "SM55555555555555555555555555555555";

    await postWebhook(
      baseUrl,
      webhookBody({
        MessageSid: messageSid,
        Body: "Photo attached.",
        NumMedia: "1",
        MediaUrl0: `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}/Media/ME${"e".repeat(32)}`,
        MediaContentType0: "image/jpeg",
      }),
    );
    await agent.idle();
    const caseId = repairStore.list()[0]!.id;

    expect(delivered).toEqual([]);
    expect(repairStore.recoverAgentWork()).toEqual([caseId]);

    agent.wake(caseId);
    await agent.idle();
    expect(repairStore.get(caseId)).toMatchObject({
      photoEvidence: [expect.objectContaining({ status: "available" })],
      repairAgent: { phase: "waiting_for_manager" },
    });
    expect(delivered).toEqual(["Thanks. I recorded this for the property manager."]);
  });

  it("keeps photo follow-up questions in the same case until manager review is ready", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
    let modelCall = 0;
    const model = vi.fn(async () => {
      modelCall += 1;
      if (modelCall === 2) {
        return {
          ...decision("Is the water still running, and have you switched the light off?"),
          nextStep: "ask_tenant" as const,
        };
      }
      return { ...decision(), nextStep: "manager_review" as const };
    });
    const delivered: string[] = [];
    const agent = createRepairAgent({
      downloadPhotoEvidence: async () => ({
        contentType: "image/jpeg",
        dataBase64: jpeg.toString("base64"),
      }),
      prepareManagerReview: model,
      sendTenantText: async (body) => {
        delivered.push(body);
        return { delivery: "local_outbox", providerId: `local-${delivered.length}` };
      },
    });
    const { server, baseUrl } = await startServer(createApp({ scheduleAgentRun: agent.wake }));
    servers.push(server);

    await postWebhook(baseUrl);
    await agent.idle();
    const caseId = repairStore.list()[0]!.id;

    const photoMessageSid = "SM22222222222222222222222222222222";
    await postWebhook(
      baseUrl,
      webhookBody({
        MessageSid: photoMessageSid,
        Body: "Here is the bathroom photo.",
        NumMedia: "1",
        MediaUrl0: `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${photoMessageSid}/Media/ME${"b".repeat(32)}`,
        MediaContentType0: "image/jpeg",
      }),
    );
    await agent.idle();

    expect(repairStore.list()).toHaveLength(1);
    expect(repairStore.get(caseId).repairAgent).toMatchObject({ phase: "waiting_for_tenant" });
    expect(delivered[1]).toMatch(/water still running/i);

    await postWebhook(
      baseUrl,
      webhookBody({
        MessageSid: "SM33333333333333333333333333333333",
        Body: "The water is still running and the light is off.",
      }),
    );
    await agent.idle();

    expect(repairStore.list()).toHaveLength(1);
    expect(repairStore.get(caseId).repairAgent).toMatchObject({ phase: "waiting_for_manager" });
    expect(model).toHaveBeenCalledTimes(3);
    expect(delivered).toHaveLength(3);
  });

  it("acknowledges before model work, deduplicates MessageSid, sends once, and exposes the tenant-photo pause", async () => {
    let releaseModel!: (value: RepairAgentDecision) => void;
    const model = vi.fn(
      () => new Promise<RepairAgentDecision>((resolve) => (releaseModel = resolve)),
    );
    const delivered: string[] = [];
    const scheduled: string[] = [];
    const agent = createRepairAgent({
      prepareManagerReview: model,
      sendTenantText: async (body) => {
        delivered.push(body);
        return { delivery: "twilio", providerId: "SM99999999999999999999999999999999" };
      },
    });
    const { server, baseUrl } = await startServer(
      createApp({
        scheduleAgentRun: (caseId) => {
          scheduled.push(caseId);
          agent.wake(caseId);
        },
      }),
    );
    servers.push(server);

    const first = await postWebhook(baseUrl);
    expect(first.status).toBe(200);
    expect(await first.text()).toBe("<Response></Response>");
    await waitFor(() => model.mock.calls.length === 1);

    const duplicate = await postWebhook(baseUrl);
    expect(duplicate.status).toBe(200);
    releaseModel(decision());
    await agent.idle();

    const [repair] = repairStore.list();
    expect(repair.messages.filter(({ party }) => party === "tenant")).toHaveLength(1);
    expect(repair.messages.filter(({ party }) => party === "agent")).toHaveLength(1);
    expect(repair.repairAgent).toMatchObject({
      phase: "waiting_for_tenant",
      events: [{ status: "handled" }],
      effects: [{ status: "succeeded", attempts: 1, providerId: "…999999" }],
    });
    expect(repair.activity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Tenant sent a verified text" }),
        expect.objectContaining({ label: "Waiting for tenant photo evidence" }),
        expect.objectContaining({ label: "Tenant reply accepted by provider" }),
      ]),
    );
    expect(delivered).toEqual([expect.stringMatching(/photo/i)]);
    expect(scheduled).toHaveLength(1);
    expect(JSON.stringify(repair)).not.toContain(webhookBody().MessageSid);
    expect(JSON.stringify(repair)).not.toContain("SM99999999999999999999999999999999");

    const visible = await fetch(`${baseUrl}/api/cases/${repair.id}`, {
      headers: { Authorization: managerAuthorization },
    }).then((response) => response.json());
    expect(JSON.stringify(visible)).not.toContain(tenantPhone);
    expect(visible).toMatchObject({
      repair: {
        tenant: { phone: "tenant" },
        repairAgent: { phase: "waiting_for_tenant" },
      },
    });

    const bypass = await fetch(`${baseUrl}/api/cases/${repair.id}/messages/tenant`, {
      method: "POST",
      headers: {
        Authorization: managerAuthorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body: "Bypass the journal." }),
    });
    expect(bypass.status).toBe(409);
    expect(delivered).toHaveLength(1);
    expect(
      (
        await fetch(`${baseUrl}/api/dev/reset`, {
          method: "POST",
          headers: { Authorization: managerAuthorization },
        })
      ).status,
    ).toBe(409);
  });

  it("serializes one case and rejects stale model work when a second text arrives", async () => {
    let releaseFirst!: (value: RepairAgentDecision) => void;
    let active = 0;
    let maximumActive = 0;
    const seenMessageCounts: number[] = [];
    const prepareManagerReview = vi.fn(async (input: { messages: unknown[] }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      seenMessageCounts.push(input.messages.length);
      try {
        if (seenMessageCounts.length === 1) {
          return await new Promise<RepairAgentDecision>((resolve) => (releaseFirst = resolve));
        }
        return decision("I recorded both updates for the property manager.");
      } finally {
        active -= 1;
      }
    });
    const delivered: string[] = [];
    const agent = createRepairAgent({
      prepareManagerReview,
      sendTenantText: async (body) => {
        delivered.push(body);
        return { delivery: "twilio", providerId: "SM33333333333333333333333333333333" };
      },
    });
    const { server, baseUrl } = await startServer(
      createApp({ scheduleAgentRun: agent.wake }),
    );
    servers.push(server);

    await postWebhook(baseUrl);
    await waitFor(() => prepareManagerReview.mock.calls.length === 1);
    await postWebhook(
      baseUrl,
      webhookBody({
        MessageSid: "SM22222222222222222222222222222222",
        Body: "The light is off and everyone is clear.",
      }),
    );
    releaseFirst(decision("This stale reply must not be sent."));
    await agent.idle();

    const [repair] = repairStore.list();
    expect(maximumActive).toBe(1);
    expect(seenMessageCounts).toEqual([1, 2]);
    expect(delivered).toEqual([expect.stringMatching(/photo/i)]);
    expect(repair.repairAgent?.runs.map(({ status }) => status)).toContain("superseded");
    expect(repair.repairAgent?.events).toHaveLength(2);
  });

  it("retries one saved effect after a known rejection and never retries an unknown result", async () => {
    let attempt = 0;
    const agent = createRepairAgent({
      prepareManagerReview: async () => decision(),
      sendTenantText: async () => {
        attempt += 1;
        if (attempt === 1) throw new KnownTextDeliveryFailure("Rejected before send.");
        return { delivery: "twilio", providerId: "SM44444444444444444444444444444444" };
      },
    });
    const { server, baseUrl } = await startServer(
      createApp({ scheduleAgentRun: agent.wake }),
    );
    servers.push(server);

    await postWebhook(baseUrl);
    await agent.idle();
    const caseId = repairStore.list()[0]!.id;
    expect(repairStore.get(caseId).repairAgent?.effects).toEqual([
      expect.objectContaining({ status: "retryable", attempts: 1 }),
    ]);

    agent.wake(caseId);
    await agent.idle();
    expect(repairStore.get(caseId).repairAgent?.effects).toEqual([
      expect.objectContaining({ status: "succeeded", attempts: 2 }),
    ]);

    const unknownAgent = createRepairAgent({
      prepareManagerReview: async () => decision("A second case reply."),
      sendTenantText: async () => {
        throw new Error("Connection ended after dispatch.");
      },
    });
    repairStore.reset();
    const secondApp = await startServer(
      createApp({ scheduleAgentRun: unknownAgent.wake }),
    );
    servers.push(secondApp.server);
    await postWebhook(secondApp.baseUrl, webhookBody({ MessageSid: "SM55555555555555555555555555555555" }));
    await unknownAgent.idle();
    const unknownCaseId = repairStore.list()[0]!.id;
    unknownAgent.wake(unknownCaseId);
    await unknownAgent.idle();
    expect(repairStore.get(unknownCaseId).repairAgent?.effects).toEqual([
      expect.objectContaining({ status: "unknown", attempts: 1 }),
    ]);
  });

  it("supersedes a known-unsent stale reply when a newer tenant update arrives", async () => {
    const attempted: string[] = [];
    const agent = createRepairAgent({
      prepareManagerReview: async ({ messages }) =>
        decision(
          messages.length === 1
            ? "This older reply was not accepted."
            : "I recorded the latest update for the property manager.",
        ),
      sendTenantText: async (body) => {
        attempted.push(body);
        if (attempted.length === 1) throw new KnownTextDeliveryFailure("Rejected before send.");
        return { delivery: "twilio", providerId: "SM88888888888888888888888888888888" };
      },
    });
    const { server, baseUrl } = await startServer(createApp({ scheduleAgentRun: agent.wake }));
    servers.push(server);

    await postWebhook(baseUrl);
    await agent.idle();
    await postWebhook(
      baseUrl,
      webhookBody({
        MessageSid: "SM20000000000000000000000000000002",
        Body: "The leak has now stopped.",
      }),
    );
    await agent.idle();
    agent.wake(repairStore.list()[0]!.id);
    await agent.idle();

    expect(attempted).toHaveLength(2);
    expect(attempted.every((body) => /photo/i.test(body))).toBe(true);
    expect(repairStore.list()[0]?.repairAgent?.effects).toEqual([
      expect.objectContaining({ status: "superseded", attempts: 1 }),
      expect.objectContaining({ status: "succeeded", attempts: 1 }),
    ]);
  });

  it("enforces the emergency message even when attached photo download fails", async () => {
    const delivered: string[] = [];
    const agent = createRepairAgent({
      downloadPhotoEvidence: async () => {
        throw new Error("Twilio media is temporarily unavailable.");
      },
      prepareManagerReview: async () => decision("This routine reply must be replaced."),
      sendTenantText: async (body) => {
        delivered.push(body);
        return { delivery: "local_outbox", providerId: "local-emergency" };
      },
    });
    const { server, baseUrl } = await startServer(createApp({ scheduleAgentRun: agent.wake }));
    servers.push(server);

    const messageSid = "SM99999999999999999999999999999999";
    await postWebhook(
      baseUrl,
      webhookBody({
        MessageSid: messageSid,
        Body: "I smell gas in the hallway.",
        NumMedia: "1",
        MediaUrl0: `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}/Media/ME${"d".repeat(32)}`,
        MediaContentType0: "image/jpeg",
      }),
    );
    await agent.idle();

    expect(repairStore.list()[0]).toMatchObject({
      severity: "emergency",
      repairAgent: { phase: "waiting_for_manager" },
    });
    expect(delivered).toEqual([
      expect.stringMatching(/leave the area and call 911.*not emergency dispatch/i),
    ]);
  });

  it("returns failed model work to the durable queue and succeeds on the next wake", async () => {
    let modelAttempt = 0;
    const delivered: string[] = [];
    const agent = createRepairAgent({
      prepareManagerReview: async () => {
        modelAttempt += 1;
        if (modelAttempt === 1) throw new Error("Temporary model failure.");
        return decision();
      },
      sendTenantText: async (body) => {
        delivered.push(body);
        return { delivery: "local_outbox", providerId: "local-1" };
      },
    });
    const { server, baseUrl } = await startServer(
      createApp({ scheduleAgentRun: agent.wake }),
    );
    servers.push(server);

    await postWebhook(baseUrl);
    await agent.idle();
    const caseId = repairStore.list()[0]!.id;
    expect(repairStore.get(caseId).repairAgent).toMatchObject({
      events: [{ status: "pending" }],
      runs: [{ status: "failed" }],
      effects: [],
    });

    agent.wake(caseId);
    await agent.idle();
    expect(repairStore.get(caseId).repairAgent).toMatchObject({
      events: [{ status: "handled" }],
      effects: [{ status: "succeeded" }],
    });
    expect(delivered).toHaveLength(1);
  });

  it("recovers interrupted runs and quarantines uncertain sends after restart", async () => {
    const { server, baseUrl } = await startServer(createApp({ scheduleAgentRun: () => undefined }));
    servers.push(server);

    await postWebhook(baseUrl);
    const caseId = repairStore.list()[0]!.id;
    const interrupted = repairStore.startAgentRun(caseId)!;

    expect(repairStore.recoverAgentWork()).toEqual([caseId]);
    expect(repairStore.get(caseId).repairAgent).toMatchObject({
      events: [{ status: "pending" }],
      runs: [{ id: interrupted.runId, status: "interrupted" }],
    });

    const resumed = repairStore.startAgentRun(caseId)!;
    expect(repairStore.commitAgentDecision(caseId, resumed.runId, decision())).toBe(true);
    expect(repairStore.claimAgentEffect(caseId)).toMatchObject({ status: "dispatching" });

    expect(repairStore.recoverAgentWork()).toEqual([]);
    expect(repairStore.get(caseId).repairAgent?.effects).toEqual([
      expect.objectContaining({ status: "unknown", attempts: 1 }),
    ]);
  });

  it("gives the OpenAI Responses model one strict decision tool with private image input", async () => {
    const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xdb]).toString("base64");
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          output: [
            {
              type: "function_call",
              name: "continue_repair_case",
              arguments: JSON.stringify(decision()),
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const model = createOpenAIRepairAgentModel({
      fetch: fetchMock as typeof fetch,
      env: {
        OPENAI_API_KEY: "test-openai-key",
        OPENAI_TEXT_MODEL: "test-text-model",
      },
    });

    await expect(
      model({
        caseId: "controlled-live-repair",
        messages: [{ party: "tenant", body: "The bathroom ceiling is leaking." }],
        photos: [{ contentType: "image/jpeg", dataBase64: jpegBase64 }],
      }),
    ).resolves.toEqual(decision());

    const request = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(fetchMock.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
    expect(request).toMatchObject({
      model: "test-text-model",
      store: false,
      parallel_tool_calls: false,
      tool_choice: { type: "function", name: "continue_repair_case" },
      tools: [{ type: "function", name: "continue_repair_case", strict: true }],
    });
    expect(request.input[0].content).toEqual([
      expect.objectContaining({ type: "input_text" }),
      {
        type: "input_image",
        image_url: `data:image/jpeg;base64,${jpegBase64}`,
      },
    ]);
    expect(request.tools).toHaveLength(1);
    expect(request.tools.map(({ name }: { name: string }) => name)).not.toContain("approve");
    expect(request.tools.map(({ name }: { name: string }) => name)).not.toContain("book");
  });

  it("wires the default OpenAI and Twilio adapters without persisting phone bindings", async () => {
    const realFetch = globalThis.fetch;
    const routedFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:")) return realFetch(input, init);
      if (url === "https://api.openai.com/v1/responses") {
        return new Response(
          JSON.stringify({
            output: [
              {
                type: "function_call",
                name: "continue_repair_case",
                arguments: JSON.stringify(decision()),
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("api.twilio.com")) {
        return new Response(
          JSON.stringify({ sid: "SM77777777777777777777777777777777" }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", routedFetch);
    const { liveRepairAgent } = await import("./repair-agent.js");
    const { server, baseUrl } = await startServer(createApp());
    servers.push(server);

    expect(
      (
        await postWebhook(
          baseUrl,
          webhookBody({ MessageSid: "SM66666666666666666666666666666666" }),
        )
      ).status,
    ).toBe(200);
    await liveRepairAgent.idle();

    const externalUrls = routedFetch.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.startsWith("https://"));
    expect(externalUrls).toEqual([
      "https://api.openai.com/v1/responses",
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    ]);
    expect(
      routedFetch.mock.calls.find(([input]) => String(input).includes("api.twilio.com"))?.[1]
        ?.signal,
    ).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(repairStore.list())).not.toContain(tenantPhone);
    expect(repairStore.list()[0]?.repairAgent?.effects).toEqual([
      expect.objectContaining({ status: "succeeded", providerId: "…777777" }),
    ]);
  });
});
