import { afterEach, expect, it, vi } from "vitest";

vi.mock("react", () => ({
  useEffect: (effect: () => unknown) => effect(),
  useRef: <T,>(value: T) => ({ current: value }),
  useState: <T,>(value: T) => [value, () => undefined],
}));

import { useRepairWebMcp } from "./webmcp";

afterEach(() => vi.unstubAllGlobals());

it("registers the public booking workflow without a manager-approval tool", async () => {
  const registerTool = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("document", { modelContext: { registerTool } });
  vi.stubGlobal("navigator", {});

  useRepairWebMcp({ cases: [], controlledLiveMode: false, onChanged: () => undefined });
  await vi.waitFor(() => expect(registerTool).toHaveBeenCalledTimes(12));

  const names = registerTool.mock.calls.map(([tool]) => tool.name as string);
  expect(names).toEqual(
    expect.arrayContaining([
      "record_tenant_access_authorization",
      "record_contractor_confirmation",
      "book_approved_visit",
    ]),
  );
  expect(
    names
      .filter((name) => name !== "book_approved_visit")
      .some((name) => name.includes("approv")),
  ).toBe(false);
});

it("limits controlled-live WebMCP to shared-case inspection and contractor preparation", async () => {
  const registerTool = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("document", { modelContext: { registerTool } });
  vi.stubGlobal("navigator", {});

  useRepairWebMcp({ cases: [], controlledLiveMode: true, onChanged: () => undefined });
  await vi.waitFor(() => expect(registerTool).toHaveBeenCalledTimes(5));

  expect(registerTool.mock.calls.map(([tool]) => tool.name as string)).toEqual([
    "list_open_repairs",
    "get_repair_case",
    "get_contractor_path",
    "propose_preferred_contractor_visit",
    "record_tenant_access_authorization",
  ]);
});
