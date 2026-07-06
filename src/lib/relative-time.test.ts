import { afterEach, describe, expect, it, vi } from "vitest";
import { relativeTime } from "./relative-time";

// Built from local-time components (not a UTC ISO string) so the calendar-day
// boundaries the function checks line up the same way regardless of which
// timezone the test runs in.
const NOW = new Date(2026, 6, 6, 12, 0, 0); // Monday, July 6, 2026, local noon

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports under a minute as Just now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(new Date(NOW.getTime() - 20_000))).toBe("Just now");
  });

  it("reports minutes-ago for anything under an hour", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(relativeTime(new Date(NOW.getTime() - 45 * 60_000))).toBe("45 min ago");
  });

  it("reports Today for an earlier time on the same calendar day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const earlierToday = new Date(2026, 6, 6, 2, 0, 0);
    expect(relativeTime(earlierToday)).toBe("Today");
  });

  it("reports Yesterday for a time on the previous calendar day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const lateYesterday = new Date(2026, 6, 5, 23, 0, 0);
    expect(relativeTime(lateYesterday)).toBe("Yesterday");
  });

  it("reports a weekday name for 2-5 days ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const threeDaysAgo = new Date(2026, 6, 3, 12, 0, 0);
    expect(relativeTime(threeDaysAgo)).toBe(threeDaysAgo.toLocaleDateString(undefined, { weekday: "long" }));
  });

  it("reports month/day without a year for an older date in the same year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const earlierThisYear = new Date(2026, 0, 15, 12, 0, 0);
    expect(relativeTime(earlierThisYear)).toBe(
      earlierThisYear.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    );
  });

  it("reports month/day with a year for a date in a previous year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const lastYear = new Date(2025, 0, 1, 12, 0, 0);
    expect(relativeTime(lastYear)).toBe(
      lastYear.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    );
  });
});
