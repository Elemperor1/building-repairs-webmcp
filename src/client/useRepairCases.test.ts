import { expect, it, vi } from "vitest";
import { startSharedCasePolling } from "./useRepairCases";

it("checks the controlled-live shared case every three seconds while the page is visible", async () => {
  let tick!: () => void;
  const refresh = vi.fn(async () => undefined);
  const schedule = vi.fn((callback: () => void, milliseconds: number) => {
    tick = callback;
    return 42;
  });
  const cancel = vi.fn();
  let hidden = false;

  const stop = startSharedCasePolling({
    refresh,
    hidden: () => hidden,
    schedule,
    cancel,
  });

  expect(schedule).toHaveBeenCalledWith(expect.any(Function), 3000);
  tick();
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  hidden = true;
  tick();
  expect(refresh).toHaveBeenCalledTimes(1);
  stop();
  expect(cancel).toHaveBeenCalledWith(42);
});
