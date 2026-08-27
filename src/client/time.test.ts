import { describe, expect, it } from "vitest";
import { formatTime, formatTimeWindow } from "./time";

describe("demo time formatting", () => {
  it("renders instants and visit windows in the fixture time zone", () => {
    expect(formatTime("2030-02-03T12:00:00.000Z", "America/New_York")).toBe("7:00 AM");
    const window = formatTimeWindow(
      "2030-02-03T15:00:00.000Z/2030-02-03T16:00:00.000Z",
      "America/New_York",
    );
    expect(window).toContain("10:00");
    expect(window).toContain("11:00");
  });
});
