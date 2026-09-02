import type { RepairCase } from "../../shared/types.js";
import { describe, expect, it } from "vitest";
import { formatMoney, tenantConfirmationStatus } from "./ManagerControlPlane.js";

describe("manager approval price", () => {
  it("shows the exact stored cents", () => {
    expect(formatMoney(16_050, "USD")).toBe("$160.50");
  });

  it.each([
    ["succeeded", "Provider accepted"],
    ["unknown", "Unknown"],
    ["failed", "Failed"],
    ["retryable", "Pending"],
    ["none", "Not sent"],
  ] as const)("derives tenant confirmation status from a %s effect", (status, expected) => {
    const repair = {
      repairAgent: {
        effects:
          status === "none"
            ? []
            : [{ type: "tenant_sms", purpose: "booking_confirmation", status }],
      },
    } as unknown as RepairCase;

    expect(tenantConfirmationStatus(repair)).toBe(expected);
  });
});
