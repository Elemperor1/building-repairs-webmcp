import { describe, expect, it } from "vitest";
import type { ContractorAgreement, RepairCase } from "../shared/types.js";
import { contractorSelection } from "./contractor-selection.js";

const repair = (overrides: Partial<RepairCase> = {}): RepairCase => ({
  id: "repair-policy-1",
  buildingId: "18-hawthorn-court",
  title: "Leaking pipe",
  summary: "A pipe is leaking under the kitchen sink.",
  trade: "plumbing",
  severity: "routine",
  status: "new",
  tenant: { name: "Maya", unit: "Flat 3B", phone: "+447700900123" },
  createdAt: "2026-08-26T10:00:00.000Z",
  updatedAt: "2026-08-26T10:00:00.000Z",
  messages: [],
  activity: [],
  contractorAttempts: [],
  ...overrides,
});

const agreement = (overrides: Partial<ContractorAgreement> = {}): ContractorAgreement => ({
  id: "agreement-primary-plumber",
  buildingId: "18-hawthorn-court",
  trade: "plumbing",
  contractorName: "Hawthorn Plumbing",
  contractorPhone: "020 7946 0100",
  priority: 1,
  coveredWork: "Plumbing call-outs and first-hour labour",
  coveredSeverities: ["routine", "urgent", "emergency"],
  pricing: { basis: "fixed", amountPence: 12500, description: "Agreed call-out and first hour" },
  coverageHours: {
    description: "Monday–Sunday, 08:00–20:00",
    timeZone: "Europe/London",
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    startsAt: "08:00",
    endsAt: "20:00",
  },
  responseMinutes: { routine: 1440, urgent: 240, emergency: 90 },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  ...overrides,
});

describe("contractor selection", () => {
  it("selects the first eligible approved agreement for the repair", () => {
    const decision = contractorSelection.assess({
      repair: repair(),
      agreements: [
        agreement({ id: "agreement-backup", contractorName: "Backup Plumbing", priority: 2 }),
        agreement(),
      ],
      now: new Date("2026-08-26T12:00:00.000Z"),
    });

    expect(decision).toEqual({
      kind: "preferred_available",
      agreementId: "agreement-primary-plumber",
      contractorName: "Hawthorn Plumbing",
      priority: 1,
      priceBasis: "Agreed call-out and first hour",
      costPence: 12500,
      responseMinutes: 1440,
    });
  });

  it("skips agreements that do not cover the repair severity or current hours", () => {
    const decision = contractorSelection.assess({
      repair: repair({ severity: "urgent" }),
      agreements: [
        agreement({ coveredSeverities: ["routine"] }),
        agreement({
          id: "agreement-backup",
          contractorName: "24-hour Backup Plumbing",
          priority: 2,
          coverageHours: {
            description: "Every day",
            timeZone: "Europe/London",
            days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
            startsAt: "00:00",
            endsAt: "23:59",
          },
        }),
      ],
      now: new Date("2026-08-26T21:30:00.000Z"),
    });

    expect(decision).toMatchObject({
      kind: "preferred_available",
      agreementId: "agreement-backup",
      contractorName: "24-hour Backup Plumbing",
    });
  });

  it("selects the first agreement whose response commitment meets the deadline", () => {
    const decision = contractorSelection.assess({
      repair: repair({ severity: "urgent" }),
      agreements: [
        agreement(),
        agreement({
          id: "agreement-fast-backup",
          contractorName: "Fast Backup Plumbing",
          priority: 2,
          responseMinutes: { routine: 1440, urgent: 30, emergency: 30 },
        }),
      ],
      now: new Date("2026-08-26T12:30:00.000Z"),
      requiredBy: "2026-08-26T13:30:00.000Z",
    });

    expect(decision).toMatchObject({
      kind: "preferred_available",
      agreementId: "agreement-fast-backup",
      contractorName: "Fast Backup Plumbing",
    });
  });

  it("records primary unavailability and advances to the approved backup", () => {
    const update = contractorSelection.recordUnavailable({
      repair: repair(),
      agreements: [agreement(), agreement({ id: "agreement-backup", contractorName: "Backup Plumbing", priority: 2 })],
      agreementId: "agreement-primary-plumber",
      reason: "No engineer is available this afternoon.",
      earliestAvailableAt: "2026-08-27T08:00:00.000Z",
      now: new Date("2026-08-26T12:15:00.000Z"),
    });

    expect(update.attempt).toMatchObject({
      agreementId: "agreement-primary-plumber",
      contractorName: "Hawthorn Plumbing",
      reason: "No engineer is available this afternoon.",
      earliestAvailableAt: "2026-08-27T08:00:00.000Z",
      recordedAt: "2026-08-26T12:15:00.000Z",
    });
    expect(update.decision).toMatchObject({
      kind: "preferred_available",
      agreementId: "agreement-backup",
      contractorName: "Backup Plumbing",
      priority: 2,
    });
  });

  it("blocks external search for a routine repair without manager instruction", () => {
    expect(() =>
      contractorSelection.startExternalSearch({
        repair: repair(),
        agreements: [agreement()],
        requiredBy: "2026-08-27T12:00:00.000Z",
        requestedByManager: undefined,
        now: new Date("2026-08-26T12:30:00.000Z"),
      }),
    ).toThrow("Routine repairs need property-manager instruction before external search.");
  });

  it("blocks urgent external search while an approved contractor remains", () => {
    expect(() =>
      contractorSelection.startExternalSearch({
        repair: repair({ severity: "urgent" }),
        agreements: [agreement()],
        requiredBy: "2026-08-26T17:00:00.000Z",
        requestedByManager: undefined,
        now: new Date("2026-08-26T12:30:00.000Z"),
      }),
    ).toThrow("Try every eligible approved contractor before external search.");
  });

  it("authorizes urgent external search after every approved contractor is unavailable", () => {
    const urgentRepair = repair({
      severity: "urgent",
      contractorAttempts: [
        {
          id: "attempt-primary",
          agreementId: "agreement-primary-plumber",
          contractorName: "Hawthorn Plumbing",
          reason: "No engineer available today.",
          earliestAvailableAt: "2026-08-27T08:00:00.000Z",
          recordedAt: "2026-08-26T12:10:00.000Z",
        },
        {
          id: "attempt-backup",
          agreementId: "agreement-backup",
          contractorName: "Backup Plumbing",
          reason: "Cannot arrive within four hours.",
          earliestAvailableAt: "2026-08-26T19:00:00.000Z",
          recordedAt: "2026-08-26T12:20:00.000Z",
        },
      ],
    });

    const authorization = contractorSelection.startExternalSearch({
      repair: urgentRepair,
      agreements: [agreement(), agreement({ id: "agreement-backup", contractorName: "Backup Plumbing", priority: 2 })],
      requiredBy: "2026-08-26T16:00:00.000Z",
      requestedByManager: undefined,
      now: new Date("2026-08-26T12:30:00.000Z"),
    });

    expect(authorization).toEqual({
      authorizedAt: "2026-08-26T12:30:00.000Z",
      requiredBy: "2026-08-26T16:00:00.000Z",
      requestedByManager: undefined,
      reason:
        "Hawthorn Plumbing and Backup Plumbing cannot meet the required response time for this urgent repair.",
      searchBrief: {
        buildingId: "18-hawthorn-court",
        trade: "plumbing",
        severity: "urgent",
        requiredBy: "2026-08-26T16:00:00.000Z",
      },
    });
  });

  it("blocks urgent external search when a preferred contractor can still meet the deadline", () => {
    expect(() =>
      contractorSelection.startExternalSearch({
        repair: repair({
          severity: "urgent",
          contractorAttempts: [
            {
              id: "attempt-primary",
              agreementId: "agreement-primary-plumber",
              contractorName: "Hawthorn Plumbing",
              reason: "The engineer offered a later appointment.",
              earliestAvailableAt: "2026-08-26T15:30:00.000Z",
              recordedAt: "2026-08-26T12:10:00.000Z",
            },
          ],
        }),
        agreements: [agreement()],
        requiredBy: "2026-08-26T17:00:00.000Z",
        requestedByManager: undefined,
        now: new Date("2026-08-26T12:30:00.000Z"),
      }),
    ).toThrow("An approved contractor can still meet the required response time.");
  });

  it("explains fallback when no approved agreement can meet the deadline", () => {
    const authorization = contractorSelection.startExternalSearch({
      repair: repair({ severity: "urgent" }),
      agreements: [agreement()],
      requiredBy: "2026-08-26T13:30:00.000Z",
      requestedByManager: undefined,
      now: new Date("2026-08-26T12:30:00.000Z"),
    });

    expect(authorization.reason).toBe(
      "No eligible approved contractor can meet the required response time for this urgent repair.",
    );
  });

  it("authorizes routine external search when a named property manager requests it", () => {
    const authorization = contractorSelection.startExternalSearch({
      repair: repair(),
      agreements: [agreement()],
      requiredBy: "2026-08-27T12:00:00.000Z",
      requestedByManager: "Priya Shah",
      now: new Date("2026-08-26T12:45:00.000Z"),
    });

    expect(authorization).toMatchObject({
      authorizedAt: "2026-08-26T12:45:00.000Z",
      requestedByManager: "Priya Shah",
      reason: "Priya Shah requested external options for this routine repair.",
      searchBrief: { trade: "plumbing", severity: "routine" },
    });
  });
});
