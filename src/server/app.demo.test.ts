import { EventEmitter } from "node:events";
import httpMocks from "node-mocks-http";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

vi.stubEnv("DEMO_MODE", "true");
let resetAt = new Date("2030-02-03T12:00:00.000Z");
const app = createApp({ now: () => resetAt });

async function callApp(
  method: "GET" | "POST",
  url: string,
  body?: Record<string, unknown>,
  target = app,
) {
  const request = httpMocks.createRequest({ method, url, body });
  const response = httpMocks.createResponse({ eventEmitter: EventEmitter });

  await new Promise<void>((resolve, reject) => {
    response.once("end", resolve);
    target(request, response, (error) => {
      if (error) reject(error);
      else response.status(404).json({ error: "Not found." });
    });
  });

  return {
    status: response.statusCode,
    body: response._getJSONData() as unknown,
  };
}

describe("isolated Pennsylvania demo HTTP interface", () => {
  beforeEach(() => {
    resetAt = new Date("2030-02-03T12:00:00.000Z");
  });

  afterAll(async () => {
    await callApp("POST", "/api/demo/reset");
    vi.unstubAllEnvs();
  });

  it("resets the synthetic repair from the current server time", async () => {
    const reset = await callApp("POST", "/api/demo/reset");
    expect(reset).toEqual({
      status: 200,
      body: { resetAt: "2030-02-03T12:00:00.000Z", caseId: "demo-repair-leak" },
    });

    const response = await callApp("GET", "/api/cases/demo-repair-leak");
    expect(response.body).toMatchObject({
      repair: {
        id: "demo-repair-leak",
        buildingId: "demo-pa-building",
        createdAt: "2030-02-03T12:00:00.000Z",
        requiredBy: "2030-02-03T18:00:00.000Z",
        tenant: { name: "Maya Chen (demo tenant)", phone: "+14125550101" },
        messages: [{ sentAt: "2030-02-03T12:00:00.000Z" }],
        demoFixture: {
          organization: {
            id: "demo-pa-org",
            name: "Fix This Demo Property Management",
            jurisdiction: "US-PA",
            timeZone: "America/New_York",
          },
          building: {
            id: "demo-pa-building",
            name: "Hawthorn Court Demo Apartments",
            address: "100 Demo Way, Pittsburgh, PA 15222",
          },
          manager: { id: "demo-manager-priya", name: "Priya Shah (demo manager)" },
          tenantId: "demo-tenant-maya",
          mediaId: "demo-bathroom-leak",
          resetAt: "2030-02-03T12:00:00.000Z",
          primaryAgreementId: "demo-pa-plumbing-primary",
          backupAgreementId: "demo-pa-plumbing-backup",
          accessWindow: "2030-02-03T14:00:00.000Z/2030-02-03T18:00:00.000Z",
          primaryEarliestAvailableAt: "2030-02-04T12:00:00.000Z",
          backupVisitWindow: "2030-02-03T15:00:00.000Z/2030-02-03T16:00:00.000Z",
        },
      },
    });
    expect((await callApp("GET", "/api/cases")).body).toMatchObject({ demoMode: true });
    expect((await callApp("GET", "/api/health")).body).toMatchObject({
      demoMode: true,
      smsDelivery: "demo_outbox",
      voiceCallAllowlist: [],
    });
  });

  it("accepts only a fixed demo sender and bundled MMS asset", async () => {
    await callApp("POST", "/api/demo/reset");

    const response = await callApp("POST", "/api/demo/messages", {
      sender: "tenant",
      body: "The light is off and there is no pooling.",
      mediaId: "demo-bathroom-leak",
    });

    expect(response).toMatchObject({
      status: 201,
      body: {
        repair: {
          id: "demo-repair-leak",
          messages: [
            {},
            {
              party: "tenant",
              body: "The light is off and there is no pooling.",
              channel: "mms",
              mediaId: "demo-bathroom-leak",
            },
          ],
        },
      },
    });
  });

  it("rejects arbitrary simulator identities, remote media, and provider webhooks", async () => {
    await callApp("POST", "/api/demo/reset");

    expect(
      await callApp("POST", "/api/demo/messages", {
        sender: "arbitrary-person",
        body: "Hello",
      }),
    ).toMatchObject({ status: 400 });
    expect(
      await callApp("POST", "/api/demo/messages", {
        sender: "tenant",
        body: "Hello",
        mediaUrl: "https://example.test/personal-photo.jpg",
      }),
    ).toMatchObject({ status: 400 });
    expect(
      await callApp("POST", "/api/sms/inbound", {
        from: "+14125559999",
        body: "Create a real repair",
      }),
    ).toMatchObject({ status: 404 });
  });

  it("clears simulated messages and the demo outbox on every reset", async () => {
    await callApp("POST", "/api/demo/reset");
    await callApp("POST", "/api/demo/messages", {
      sender: "tenant",
      body: "The light is off.",
    });
    await callApp("POST", "/api/cases/demo-repair-leak/messages/tenant", {
      body: "Thanks. A demo contractor is being checked.",
    });

    const firstOutbox = await callApp("GET", "/api/outbox");
    expect(firstOutbox.body).toMatchObject({
      messages: [{ delivery: "demo_outbox", to: "+14125550101" }],
    });

    resetAt = new Date("2030-02-04T15:30:00.000Z");
    await callApp("POST", "/api/demo/reset");

    const [repair, outbox] = await Promise.all([
      callApp("GET", "/api/cases/demo-repair-leak"),
      callApp("GET", "/api/outbox"),
    ]);
    expect(repair.body).toMatchObject({
      repair: {
        createdAt: "2030-02-04T15:30:00.000Z",
        requiredBy: "2030-02-04T21:30:00.000Z",
        messages: [{ id: "demo-message-initial" }],
      },
    });
    expect(outbox.body).toEqual({ messages: [] });
  });

  it("fails closed when live messaging credentials or a voice allowlist are present", () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC00000000000000000000000000000000");
    expect(() => createApp()).toThrow("DEMO_MODE cannot start with TWILIO_ACCOUNT_SID set.");

    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("VOICE_ALLOWED_TO", "+14125550100");
    expect(() => createApp()).toThrow("DEMO_MODE cannot start with VOICE_ALLOWED_TO set.");

    vi.stubEnv("VOICE_ALLOWED_TO", "");
  });

  it("leaves the non-demo store untouched", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    const developmentApp = createApp();
    await callApp("POST", "/api/dev/reset", undefined, developmentApp);
    const created = await callApp(
      "POST",
      "/api/sms/inbound",
      {
        from: "+447700900991",
        body: "Keep this development repair.",
        tenantName: "Dev tenant",
        unit: "Dev unit",
      },
      developmentApp,
    );
    const createdId = (created.body as { repair: { id: string } }).repair.id;

    vi.stubEnv("DEMO_MODE", "true");
    await callApp("POST", "/api/demo/reset");

    vi.stubEnv("DEMO_MODE", "false");
    const developmentCases = await callApp("GET", "/api/cases", undefined, developmentApp);
    expect(developmentCases.body).toMatchObject({
      cases: expect.arrayContaining([expect.objectContaining({ id: createdId })]),
    });

    vi.stubEnv("DEMO_MODE", "true");
  });

  it("runs the approved-contractor journey twice from clean state", async () => {
    const runJourney = async () => {
      const reset = await callApp("POST", "/api/demo/reset");
      const list = await callApp("GET", "/api/cases");
      expect(list.body).toMatchObject({
        demoMode: true,
        cases: [{ id: "demo-repair-leak", status: "new" }],
      });
      const opened = await callApp("GET", "/api/cases/demo-repair-leak");
      const demoFixture = (
        opened.body as {
          repair: {
            demoFixture: {
              accessWindow: string;
              primaryEarliestAvailableAt: string;
              backupVisitWindow: string;
            };
          };
        }
      ).repair.demoFixture;
      const visitWindow = demoFixture.backupVisitWindow;

      await callApp("POST", "/api/cases/demo-repair-leak/triage", {
        title: "Water dripping near the bathroom light",
        summary: "Urgent plumbing leak; the light is off and nobody is beneath it.",
        severity: "urgent",
        trade: "plumbing",
        accessNotes: `Maya authorized ${demoFixture.accessWindow}.`,
        requiredBy: demoFixture.accessWindow.split("/")[1],
      });
      await callApp("POST", "/api/cases/demo-repair-leak/messages/tenant", {
        body: "Is the light off, and is everyone safely away from the leak?",
      });
      const safetyReply = await callApp("POST", "/api/demo/messages", {
        sender: "tenant",
        body: `The light is off, everyone is clear, and I authorize ${demoFixture.accessWindow}.`,
        mediaId: "demo-bathroom-leak",
      });
      expect(safetyReply.body).toMatchObject({
        repair: {
          messages: expect.arrayContaining([
            expect.objectContaining({ channel: "mms", mediaId: "demo-bathroom-leak" }),
          ]),
        },
      });

      const firstPath = await callApp("GET", "/api/cases/demo-repair-leak/contractor-path");
      expect(firstPath.body).toMatchObject({
        decision: { agreementId: "demo-pa-plumbing-primary", costPence: 14500 },
      });

      const unavailable = await callApp(
        "POST",
        "/api/cases/demo-repair-leak/contractor-attempts/unavailable",
        {
          agreementId: "demo-pa-plumbing-primary",
          reason: "The primary demo contractor cannot meet the urgent deadline.",
          earliestAvailableAt: demoFixture.primaryEarliestAvailableAt,
        },
      );
      expect(unavailable.body).toMatchObject({
        decision: { agreementId: "demo-pa-plumbing-backup", costPence: 16000 },
      });

      const proposal = await callApp(
        "POST",
        "/api/cases/demo-repair-leak/contractor-proposal",
        {
          agreementId: "demo-pa-plumbing-backup",
          timeWindow: visitWindow,
          reason: "The approved backup can meet the reset-relative deadline.",
        },
      );
      expect(proposal.body).toMatchObject({
        repair: { proposal: { currency: "USD", costPence: 16000, timeWindow: visitWindow } },
      });
      const proposalId = (proposal.body as { repair: { proposal: { id: string } } }).repair.proposal.id;

      const tenantMessageId = (
        safetyReply.body as { repair: { messages: Array<{ id: string }> } }
      ).repair.messages.at(-1)!.id;
      const contractorMessage = await callApp("POST", "/api/demo/messages", {
        sender: "contractor",
        body: `Three Rivers confirms ${visitWindow}.`,
      });
      const contractorMessageId = (
        contractorMessage.body as { repair: { messages: Array<{ id: string }> } }
      ).repair.messages.at(-1)!.id;
      await callApp("POST", "/api/cases/demo-repair-leak/access-authorization", {
        sourceMessageId: tenantMessageId,
        proposalId,
        timeWindow: visitWindow,
      });
      await callApp("POST", "/api/cases/demo-repair-leak/contractor-confirmation", {
        sourceMessageId: contractorMessageId,
        proposalId,
        timeWindow: visitWindow,
      });
      await callApp("POST", "/api/cases/demo-repair-leak/approve", {
        approvedBy: "Priya Shah (demo manager)",
      });
      const booked = await callApp("POST", "/api/cases/demo-repair-leak/book");
      expect(booked.body).toMatchObject({
        repair: {
          id: "demo-repair-leak",
          status: "scheduled",
          appointment: {
            contractorName: "Three Rivers Demo Plumbing",
            timeWindow: visitWindow,
            notificationId: expect.any(String),
          },
          notifications: [
            { caseId: "demo-repair-leak", delivery: "demo_outbox", to: "+14125550101" },
          ],
          approval: { approvedBy: "Priya Shah (demo manager)" },
          tenantAccessAuthorization: { sourceMessageId: tenantMessageId },
          contractorConfirmation: { sourceMessageId: contractorMessageId },
          activity: expect.arrayContaining([
            expect.objectContaining({ label: "Fix This checked the repair details" }),
            expect.objectContaining({ label: "Maya Chen (demo tenant) confirmed access" }),
            expect.objectContaining({
              label: "Three Rivers Demo Plumbing confirmed the visit",
            }),
            expect.objectContaining({
              label: "Priya Shah (demo manager) approved Three Rivers Demo Plumbing",
            }),
          ]),
        },
      });
    };

    resetAt = new Date();
    await runJourney();
    resetAt = new Date(Date.now() + 1000);
    await runJourney();

    const outbox = await callApp("GET", "/api/outbox");
    const messages = (
      outbox.body as { messages: Array<{ caseId?: string; delivery: string }> }
    ).messages;
    expect(messages.filter(({ caseId }) => caseId === "demo-repair-leak")).toEqual([
      expect.objectContaining({ delivery: "demo_outbox" }),
    ]);
  });
});
