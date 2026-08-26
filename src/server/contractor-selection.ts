import { randomUUID } from "node:crypto";
import type {
  ContractorAgreement,
  ContractorAttempt,
  ExternalSearchAuthorization,
  RepairCase,
} from "../shared/types.js";

interface AssessContractorSelectionInput {
  repair: RepairCase;
  agreements: ContractorAgreement[];
  now: Date;
  requiredBy?: string;
}

interface RecordContractorUnavailableInput extends AssessContractorSelectionInput {
  agreementId: string;
  reason: string;
  earliestAvailableAt: string;
}

interface StartExternalSearchInput extends AssessContractorSelectionInput {
  requiredBy: string;
  requestedByManager?: string;
}

export type ContractorSelectionDecision =
  | {
      kind: "preferred_available";
      agreementId: string;
      contractorName: string;
      priority: number;
      priceBasis: string;
      costPence: number;
      responseMinutes: number;
    }
  | { kind: "no_preferred_contractor" };

const activeOn = (agreement: ContractorAgreement, now: Date) => {
  const date = now.toISOString().slice(0, 10);
  return agreement.effectiveFrom <= date && agreement.effectiveTo >= date;
};

const localCoverageTime = (agreement: ContractorAgreement, now: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: agreement.coverageHours.timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return { weekday: part("weekday"), time: `${part("hour")}:${part("minute")}` };
};

const withinCoverage = (agreement: ContractorAgreement, now: Date) => {
  const { weekday, time } = localCoverageTime(agreement, now);
  const { days, startsAt, endsAt } = agreement.coverageHours;
  return days.includes(weekday as (typeof days)[number]) && time >= startsAt && time <= endsAt;
};

const canMeetDeadline = (
  agreement: ContractorAgreement,
  repair: RepairCase,
  now: Date,
  requiredBy?: string,
) =>
  !requiredBy ||
  now.getTime() + agreement.responseMinutes[repair.severity] * 60_000 <=
    new Date(requiredBy).getTime();

const eligibleAgreements = ({
  repair,
  agreements,
  now,
  requiredBy,
}: AssessContractorSelectionInput) =>
  agreements.filter(
    (agreement) =>
      agreement.buildingId === repair.buildingId &&
      agreement.trade === repair.trade &&
      agreement.coveredSeverities.includes(repair.severity) &&
      activeOn(agreement, now) &&
      withinCoverage(agreement, now) &&
      canMeetDeadline(agreement, repair, now, requiredBy),
  );

export const contractorSelection = {
  assess(input: AssessContractorSelectionInput): ContractorSelectionDecision {
    const { repair } = input;
    const selected = eligibleAgreements(input)
      .filter(
        (agreement) =>
          !repair.contractorAttempts.some((attempt) => attempt.agreementId === agreement.id),
      )
      .sort((left, right) => left.priority - right.priority)[0];

    if (!selected) return { kind: "no_preferred_contractor" };

    return {
      kind: "preferred_available",
      agreementId: selected.id,
      contractorName: selected.contractorName,
      priority: selected.priority,
      priceBasis: selected.pricing.description,
      costPence: selected.pricing.amountPence,
      responseMinutes: selected.responseMinutes[repair.severity],
    };
  },

  recordUnavailable({
    repair,
    agreements,
    agreementId,
    reason,
    earliestAvailableAt,
    now,
  }: RecordContractorUnavailableInput): {
    attempt: ContractorAttempt;
    decision: ContractorSelectionDecision;
  } {
    const current = this.assess({ repair, agreements, now });
    if (current.kind !== "preferred_available" || current.agreementId !== agreementId) {
      throw new Error("Check the next approved contractor before moving to a backup.");
    }
    const agreement = eligibleAgreements({ repair, agreements, now }).find(
      (candidate) => candidate.id === agreementId,
    );
    if (!agreement) throw new Error("Approved contractor agreement not found for this repair.");

    const attempt: ContractorAttempt = {
      id: randomUUID(),
      agreementId,
      contractorName: agreement.contractorName,
      reason,
      earliestAvailableAt,
      recordedAt: now.toISOString(),
    };
    const updatedRepair = {
      ...repair,
      contractorAttempts: [...repair.contractorAttempts, attempt],
    };

    return {
      attempt,
      decision: this.assess({ repair: updatedRepair, agreements, now }),
    };
  },

  startExternalSearch({
    repair,
    agreements,
    requiredBy,
    requestedByManager,
    now,
  }: StartExternalSearchInput): ExternalSearchAuthorization {
    if (repair.severity === "routine" && !requestedByManager) {
      throw new Error("Routine repairs need property-manager instruction before external search.");
    }
    if (repair.severity !== "routine") {
      const eligible = eligibleAgreements({ repair, agreements, now, requiredBy });
      const untried = eligible.some(
        (agreement) =>
          !repair.contractorAttempts.some((attempt) => attempt.agreementId === agreement.id),
      );
      if (untried) {
        throw new Error("Try every eligible approved contractor before external search.");
      }
      const stillAvailable = eligible.some((agreement) => {
        const attempt = repair.contractorAttempts.find(
          (candidate) => candidate.agreementId === agreement.id,
        );
        return attempt && new Date(attempt.earliestAvailableAt) <= new Date(requiredBy);
      });
      if (stillAvailable) {
        throw new Error("An approved contractor can still meet the required response time.");
      }
    }

    return {
      authorizedAt: now.toISOString(),
      requiredBy,
      requestedByManager,
      reason: requestedByManager
        ? `${requestedByManager} requested external options for this ${repair.severity} repair.`
        : `${new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" }).format(
            repair.contractorAttempts.map((attempt) => attempt.contractorName),
          )} cannot meet the required response time for this ${repair.severity} repair.`,
      searchBrief: {
        buildingId: repair.buildingId,
        trade: repair.trade,
        severity: repair.severity,
        requiredBy,
      },
    };
  },
};
