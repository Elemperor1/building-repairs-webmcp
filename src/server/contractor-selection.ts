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

export const contractorSelection = {
  assess({ repair, agreements, now }: AssessContractorSelectionInput): ContractorSelectionDecision {
    const selected = agreements
      .filter(
        (agreement) =>
          agreement.buildingId === repair.buildingId &&
          agreement.trade === repair.trade &&
          activeOn(agreement, now) &&
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
    const agreement = agreements.find(
      (candidate) =>
        candidate.id === agreementId &&
        candidate.buildingId === repair.buildingId &&
        candidate.trade === repair.trade &&
        activeOn(candidate, now),
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
    if (
      repair.severity !== "routine" &&
      this.assess({ repair, agreements, now }).kind === "preferred_available"
    ) {
      throw new Error("Try every eligible approved contractor before external search.");
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
