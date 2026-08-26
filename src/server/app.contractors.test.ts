import { EventEmitter } from "node:events";
import httpMocks from "node-mocks-http";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { repairStore } from "./store.js";

const app = createApp();

async function callApp(method: "GET" | "POST", url: string, body?: Record<string, unknown>) {
  const request = httpMocks.createRequest({ method, url, body });
  const response = httpMocks.createResponse({ eventEmitter: EventEmitter });

  await new Promise<void>((resolve, reject) => {
    response.once("end", resolve);
    app(request, response, reject);
  });

  return {
    status: response.statusCode,
    body: response._getJSONData() as unknown,
  };
}

beforeEach(() => repairStore.reset());
afterAll(() => repairStore.reset());

describe("contractor workflow HTTP interface", () => {
  it("returns the repair's first eligible approved contractor", async () => {
    const response = await callApp("GET", "/api/cases/repair-1001/contractor-path");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      decision: {
        kind: "preferred_available",
        agreementId: "agreement-hawthorn-plumbing-primary",
        contractorName: "Hawthorn Building Services",
        priority: 1,
        priceBasis: "Agreed emergency call-out and first hour",
        costPence: 14500,
        responseMinutes: 240,
      },
    });
  });

  it("uses the triaged response deadline throughout preferred selection", async () => {
    const inbound = await callApp("POST", "/api/sms/inbound", {
      from: "+447700900779",
      body: "Water is pouring from the kitchen pipe.",
      tenantName: "Alex",
      unit: "Flat 2D",
    });
    const created = inbound.body as { repair: { id: string } };
    const requiredBy = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    await callApp("POST", `/api/cases/${created.repair.id}/triage`, {
      title: "Kitchen pipe is leaking heavily",
      summary: "An urgent plumbing repair with active water flow.",
      severity: "urgent",
      trade: "plumbing",
      requiredBy,
    });

    const path = await callApp("GET", `/api/cases/${created.repair.id}/contractor-path`);
    expect(path.body).toMatchObject({
      decision: {
        kind: "preferred_available",
        agreementId: "agreement-hawthorn-plumbing-backup",
        contractorName: "Riverside Plumbing",
      },
    });

    const primaryProposal = await callApp(
      "POST",
      `/api/cases/${created.repair.id}/contractor-proposal`,
      {
        agreementId: "agreement-hawthorn-plumbing-primary",
        timeWindow: "Today",
        reason: "Try the primary anyway.",
      },
    );
    expect(primaryProposal.status).toBe(409);

    const backupProposal = await callApp(
      "POST",
      `/api/cases/${created.repair.id}/contractor-proposal`,
      {
        agreementId: "agreement-hawthorn-plumbing-backup",
        timeWindow: "Within three hours",
        reason: "The approved backup can meet the stored response deadline.",
      },
    );
    expect(backupProposal.status).toBe(200);
  });

  it("creates a preferred proposal from stored agreement terms", async () => {
    const response = await callApp("POST", "/api/cases/repair-1001/contractor-proposal", {
        agreementId: "agreement-hawthorn-plumbing-primary",
        timeWindow: "Today, 3:30–4:30 pm",
        reason: "Primary approved plumber can meet the urgent response window.",
        contractorName: "Caller must not choose this",
        costPence: 1,
    });

    expect(response.status).toBe(200);
    const body = response.body as { repair: { proposal: unknown } };
    expect(body.repair.proposal).toMatchObject({
      source: "agreement",
      agreementId: "agreement-hawthorn-plumbing-primary",
      contractorName: "Hawthorn Building Services",
      contractorPhone: "020 7946 0100",
      costPence: 14500,
      priceBasis: "Agreed emergency call-out and first hour",
      timeWindow: "Today, 3:30–4:30 pm",
      status: "proposed",
    });
  });

  it("records primary unavailability and returns the approved backup", async () => {
    const response = await callApp(
      "POST",
      "/api/cases/repair-1001/contractor-attempts/unavailable",
      {
        agreementId: "agreement-hawthorn-plumbing-primary",
        reason: "No plumber can attend this afternoon.",
        earliestAvailableAt: "2026-08-27T08:00:00.000Z",
      },
    );

    expect(response.status).toBe(200);
    const body = response.body as {
      repair: {
        contractorAttempts: unknown[];
        activity: Array<{ label: string; detail?: string }>;
        proposal?: unknown;
      };
      decision: unknown;
    };
    expect(body.decision).toMatchObject({
      kind: "preferred_available",
      agreementId: "agreement-hawthorn-plumbing-backup",
      contractorName: "Riverside Plumbing",
      priority: 2,
    });
    expect(body.repair.contractorAttempts).toHaveLength(1);
    expect(body.repair.proposal).toBeUndefined();
    expect(body.repair.activity.at(-1)).toMatchObject({
      label: "Hawthorn Building Services is unavailable",
      detail: "No plumber can attend this afternoon. Earliest availability: 27 Aug, 08:00.",
    });
  });

  it("rejects urgent external search while approved contractors remain", async () => {
    const response = await callApp("POST", "/api/cases/repair-1001/external-search", {
      requiredBy: "2026-08-26T23:00:00.000Z",
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "Try every eligible approved contractor before external search.",
    });
  });

  it("rejects urgent fallback when an attempted approved contractor can meet the deadline", async () => {
    await callApp("POST", "/api/cases/repair-1001/contractor-attempts/unavailable", {
      agreementId: "agreement-hawthorn-plumbing-primary",
      reason: "The primary offered tomorrow morning.",
      earliestAvailableAt: "2026-08-27T08:00:00.000Z",
    });
    await callApp("POST", "/api/cases/repair-1001/contractor-attempts/unavailable", {
      agreementId: "agreement-hawthorn-plumbing-backup",
      reason: "The backup offered late afternoon.",
      earliestAvailableAt: "2026-08-26T16:00:00.000Z",
    });

    const response = await callApp("POST", "/api/cases/repair-1001/external-search", {
      requiredBy: "2026-08-26T23:00:00.000Z",
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "An approved contractor can still meet the required response time.",
    });
  });

  it("rejects skipping the primary agreement when recording unavailability", async () => {
    const response = await callApp(
      "POST",
      "/api/cases/repair-1001/contractor-attempts/unavailable",
      {
        agreementId: "agreement-hawthorn-plumbing-backup",
        reason: "The backup cannot attend.",
        earliestAvailableAt: "2026-08-27T09:00:00.000Z",
      },
    );

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "Check the next approved contractor before moving to a backup.",
    });
  });

  it("rejects an external proposal before external search is authorized", async () => {
    const response = await callApp("POST", "/api/cases/repair-1001/proposal", {
        contractorName: "Rapid Response Plumbing",
        contractorPhone: "020 7946 0999",
        timeWindow: "Today, 2:00–3:00 pm",
        costPence: 24000,
        reason: "External urgent option.",
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "External contractor search must be authorized before adding an external proposal.",
    });
  });

  it("does not let the agent claim that a manager requested routine external search", async () => {
    const inbound = await callApp("POST", "/api/sms/inbound", {
        from: "+447700900777",
        body: "The kitchen tap is dripping.",
        tenantName: "Jordan",
        unit: "Flat 5A",
    });
    const created = inbound.body as { repair: { id: string } };
    await callApp("POST", `/api/cases/${created.repair.id}/triage`, {
        title: "Kitchen tap is dripping",
        summary: "A routine plumbing repair with no active flooding.",
        severity: "routine",
        trade: "plumbing",
    });

    const response = await callApp("POST", `/api/cases/${created.repair.id}/external-search`, {
        requiredBy: "2026-08-28T12:00:00.000Z",
        requestedByManager: "Priya Shah",
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "Routine repairs need property-manager instruction before external search.",
    });
  });

  it("allows routine external search after a property manager requests options", async () => {
    const inbound = await callApp("POST", "/api/sms/inbound", {
        from: "+447700900778",
        body: "The bedroom radiator is cold.",
        tenantName: "Sam",
        unit: "Flat 1C",
    });
    const created = inbound.body as { repair: { id: string } };
    await callApp("POST", `/api/cases/${created.repair.id}/triage`, {
        title: "Bedroom radiator is cold",
        summary: "A routine heating repair with no loss of hot water.",
        severity: "routine",
        trade: "heating",
    });

    const requestResponse = await callApp(
      "POST",
      `/api/cases/${created.repair.id}/external-search/request`,
      {
        requestedBy: "Priya Shah",
        requiredBy: "2026-08-28T12:00:00.000Z",
      },
    );
    expect(requestResponse.status).toBe(200);

    const startResponse = await callApp(
      "POST",
      `/api/cases/${created.repair.id}/external-search`,
      {},
    );

    expect(startResponse.status).toBe(200);
    expect(startResponse.body).toMatchObject({
      authorization: {
        requestedByManager: "Priya Shah",
        reason: "Priya Shah requested external options for this routine repair.",
        requiredBy: "2026-08-28T12:00:00.000Z",
        searchBrief: {
          trade: "heating",
          severity: "routine",
          requiredBy: "2026-08-28T12:00:00.000Z",
        },
      },
      repair: {
        activity: expect.arrayContaining([
          expect.objectContaining({ label: "Priya Shah requested external contractor options" }),
          expect.objectContaining({ label: "External contractor search started" }),
        ]),
      },
    });
  });
});
