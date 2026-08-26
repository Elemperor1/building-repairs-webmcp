import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { repairStore } from "./store.js";

describe("repair workflow", () => {
  beforeEach(() => {
    repairStore.reset();
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
      "The property manager must approve the proposal before booking.",
    );
  });

  it("books an approved visit and records it in the activity history", () => {
    repairStore.approve("repair-1001", "Priya Shah");
    const repair = repairStore.book("repair-1001");

    expect(repair.status).toBe("scheduled");
    expect(repair.proposal?.status).toBe("booked");
    expect(repair.appointment?.contractorName).toBe("ClearFlow Plumbing");
    expect(repair.activity.at(-1)?.label).toContain("Visit booked");
  });
});
