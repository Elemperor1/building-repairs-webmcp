import { describe, expect, it } from "vitest";
import type { RepairCase } from "../../shared/types";
import { bookingStatus } from "./ProposalPanel";

const repair = {
  status: "waiting_for_approval",
  proposal: { id: "proposal-1", timeWindow: "3:00–4:00 pm" },
} as RepairCase;

describe("proposal booking controls", () => {
  it("keeps manager approval, evidence waiting, and booking as separate actions", () => {
    expect(bookingStatus(repair).action).toBe("approve");
    expect(
      bookingStatus({
        ...repair,
        status: "approved",
        approval: {
          approvedBy: "Priya",
          approvedAt: "2026-08-27T12:00:00.000Z",
          proposalId: "proposal-1",
          timeWindow: "3:00–4:00 pm",
        },
      }).action,
    ).toBe("wait");
    expect(
      bookingStatus({
        ...repair,
        status: "approved",
        approval: {
          approvedBy: "Priya",
          approvedAt: "2026-08-27T12:00:00.000Z",
          proposalId: "proposal-1",
          timeWindow: "3:00–4:00 pm",
        },
        tenantAccessAuthorization: {
          sourceMessageId: "tenant-message",
          proposalId: "proposal-1",
          timeWindow: "3:00–4:00 pm",
          recordedAt: "2026-08-27T12:01:00.000Z",
        },
        contractorConfirmation: {
          sourceMessageId: "contractor-message",
          proposalId: "proposal-1",
          timeWindow: "3:00–4:00 pm",
          recordedAt: "2026-08-27T12:02:00.000Z",
        },
      }).action,
    ).toBe("book");
    expect(
      bookingStatus({
        ...repair,
        status: "scheduled",
        appointment: {
          contractorName: "Hawthorn Building Services",
          timeWindow: "3:00–4:00 pm",
          bookedAt: "2026-08-27T12:03:00.000Z",
        },
      }).action,
    ).toBe("retry");
    expect(
      bookingStatus({
        ...repair,
        status: "scheduled",
        appointment: {
          contractorName: "Hawthorn Building Services",
          timeWindow: "3:00–4:00 pm",
          bookedAt: "2026-08-27T12:03:00.000Z",
          notificationId: "notification-1",
        },
        notifications: [
          {
            id: "notification-1",
            caseId: "repair-1",
            to: "+441234567890",
            body: "Visit booked.",
            sentAt: "2026-08-27T12:03:01.000Z",
            delivery: "local_outbox",
          },
        ],
      }).action,
    ).toBe("complete");
  });
});
