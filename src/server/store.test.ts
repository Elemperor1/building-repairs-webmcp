import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repairStore } from "./store.js";

describe("repair workflow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-26T12:00:00.000Z");
    repairStore.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    repairStore.reset();
  });

  it("creates a real repair case from an inbound text", () => {
    const repair = repairStore.receiveSms({
      from: "+447700900999",
      body: "The kitchen tap will not stop running.",
      tenantName: "Jordan",
      unit: "Flat 5A",
    });

    expect(repair.status).toBe("new");
    expect(repair.tenant).toMatchObject({ name: "Jordan", unit: "Flat 5A" });
    expect(repair.messages.at(-1)?.body).toContain("kitchen tap");
  });

  it("blocks booking until the property manager approves the proposal", () => {
    expect(() => repairStore.book("repair-1001")).toThrow(
      "Approve the contractor and price before booking this visit.",
    );
  });

  it("records tenant access against the current proposal and exact visit window", () => {
    const repair = repairStore.recordTenantAccessAuthorization("repair-1001", {
      sourceMessageId: "message-1005",
      proposalId: "proposal-1001",
      timeWindow: "Today, 3:30–4:30 pm",
    });

    expect(repair.tenantAccessAuthorization).toMatchObject({
      sourceMessageId: "message-1005",
      proposalId: "proposal-1001",
      timeWindow: "Today, 3:30–4:30 pm",
    });
  });

  it("rejects evidence for a stale proposal", () => {
    expect(() =>
      repairStore.recordTenantAccessAuthorization("repair-1001", {
        sourceMessageId: "message-1005",
        proposalId: "proposal-before-change",
        timeWindow: "Today, 3:30–4:30 pm",
      }),
    ).toThrow(
      "That reply is for an older visit. Ask Maya to confirm Today, 3:30–4:30 pm.",
    );
  });

  it("records contractor confirmation against the current proposal and exact visit window", () => {
    const sourceMessage = repairStore.addMessage(
      "repair-1001",
      "contractor",
      "We confirm Today, 3:30–4:30 pm.",
      { from: "020 7946 0100" },
    ).messages.at(-1)!;
    const repair = repairStore.recordContractorConfirmation("repair-1001", {
      sourceMessageId: sourceMessage.id,
      proposalId: "proposal-1001",
      timeWindow: "Today, 3:30–4:30 pm",
    });

    expect(repair.contractorConfirmation).toMatchObject({
      sourceMessageId: sourceMessage.id,
      proposalId: "proposal-1001",
      timeWindow: "Today, 3:30–4:30 pm",
    });
  });

  it("rejects confirmation from a different contractor", () => {
    const sourceMessage = repairStore.addMessage(
      "repair-1001",
      "contractor",
      "We confirm Today, 3:30–4:30 pm.",
      { from: "020 7946 0188" },
    ).messages.at(-1)!;

    expect(() =>
      repairStore.recordContractorConfirmation("repair-1001", {
        sourceMessageId: sourceMessage.id,
        proposalId: "proposal-1001",
        timeWindow: "Today, 3:30–4:30 pm",
      }),
    ).toThrow("Choose a text from Hawthorn Building Services to confirm the visit.");
  });

  it("blocks an approved proposal until matching tenant access is recorded", () => {
    repairStore.approve("repair-1001", "Priya Shah");

    expect(() => repairStore.book("repair-1001")).toThrow(
      "Ask Maya to confirm access for Today, 3:30–4:30 pm.",
    );
  });

  it("binds manager approval to the current proposal and visit window", () => {
    const repair = repairStore.approve("repair-1001", "Priya Shah");

    expect(repair.approval).toMatchObject({
      proposalId: "proposal-1001",
      timeWindow: "Today, 3:30–4:30 pm",
    });
  });

  it("blocks an approved proposal until matching contractor confirmation is recorded", () => {
    repairStore.approve("repair-1001", "Priya Shah");
    repairStore.recordTenantAccessAuthorization("repair-1001", {
      sourceMessageId: "message-1005",
      proposalId: "proposal-1001",
      timeWindow: "Today, 3:30–4:30 pm",
    });

    expect(() => repairStore.book("repair-1001")).toThrow(
      "Ask Hawthorn Building Services to confirm Today, 3:30–4:30 pm.",
    );
  });

  it("invalidates every booking fact when the proposal or visit window is replaced", () => {
    repairStore.approve("repair-1001", "Priya Shah");
    repairStore.recordTenantAccessAuthorization("repair-1001", {
      sourceMessageId: "message-1005",
      proposalId: "proposal-1001",
      timeWindow: "Today, 3:30–4:30 pm",
    });
    const sourceMessage = repairStore.addMessage(
      "repair-1001",
      "contractor",
      "We confirm Today, 3:30–4:30 pm.",
      { from: "020 7946 0100" },
    ).messages.at(-1)!;
    repairStore.recordContractorConfirmation("repair-1001", {
      sourceMessageId: sourceMessage.id,
      proposalId: "proposal-1001",
      timeWindow: "Today, 3:30–4:30 pm",
    });

    const repair = repairStore.proposePreferred("repair-1001", {
      agreementId: "agreement-hawthorn-plumbing-primary",
      timeWindow: "Today, 5:00–6:00 pm",
      reason: "The visit window changed.",
    });

    expect(repair).toMatchObject({
      approval: undefined,
      tenantAccessAuthorization: undefined,
      contractorConfirmation: undefined,
    });
  });

  it("books an approved visit and records it in the activity history", () => {
    repairStore.approve("repair-1001", "Priya Shah");
    repairStore.recordTenantAccessAuthorization("repair-1001", {
      sourceMessageId: "message-1005",
      proposalId: "proposal-1001",
      timeWindow: "Today, 3:30–4:30 pm",
    });
    const sourceMessage = repairStore.addMessage(
      "repair-1001",
      "contractor",
      "We confirm Today, 3:30–4:30 pm.",
      { from: "020 7946 0100" },
    ).messages.at(-1)!;
    repairStore.recordContractorConfirmation("repair-1001", {
      sourceMessageId: sourceMessage.id,
      proposalId: "proposal-1001",
      timeWindow: "Today, 3:30–4:30 pm",
    });
    const repair = repairStore.book("repair-1001");

    expect(repair.status).toBe("scheduled");
    expect(repair.proposal?.status).toBe("booked");
    expect(repair.appointment?.contractorName).toBe("Hawthorn Building Services");
    expect(repair.activity.at(-1)?.label).toContain("Visit booked");
  });

});
