import { describe, expect, it } from "vitest";
import { buildMoodSparkline } from "./mood-sparkline";

const OPTS = { today: "2026-07-10", windowDays: 56, width: 240, height: 44, padding: 6 } as const;

describe("buildMoodSparkline", () => {
  it("returns an empty result with no path for no check-ins", () => {
    const s = buildMoodSparkline([], OPTS);
    expect(s.count).toBe(0);
    expect(s.points).toEqual([]);
    expect(s.path).toBe("");
  });

  it("puts today's check-in at the right edge and yesterday's just inside it", () => {
    const s = buildMoodSparkline(
      [
        { day: "2026-07-10", score: 3 },
        { day: "2026-07-09", score: 3 },
      ],
      OPTS,
    );
    // today: fx = 56/56 = 1 → x = padding + innerW = 6 + 228 = 234.
    const today = s.points.find((p) => p.day === "2026-07-10")!;
    const yesterday = s.points.find((p) => p.day === "2026-07-09")!;
    expect(today.x).toBe(234);
    expect(yesterday.x).toBeLessThan(today.x);
    expect(yesterday.x).toBeCloseTo(6 + (55 / 56) * 228, 1);
  });

  it("maps score 5 to the top and score 1 to the floor (y is inverted)", () => {
    const s = buildMoodSparkline(
      [
        { day: "2026-07-10", score: 5 },
        { day: "2026-07-09", score: 1 },
      ],
      OPTS,
    );
    const bright = s.points.find((p) => p.score === 5)!;
    const heavy = s.points.find((p) => p.score === 1)!;
    // padding + innerH = bottom; padding = top.
    expect(bright.y).toBe(6); // top
    expect(heavy.y).toBe(38); // 6 + 32 = bottom
    expect(bright.y).toBeLessThan(heavy.y);
  });

  it("places a mid score halfway up the inner height", () => {
    const s = buildMoodSparkline([{ day: "2026-07-10", score: 3 }], OPTS);
    // fy = (3-1)/4 = 0.5 → y = 6 + 0.5*32 = 22.
    expect(s.points[0].y).toBe(22);
  });

  it("drops check-ins older than the window and any past today", () => {
    const s = buildMoodSparkline(
      [
        { day: "2026-05-10", score: 4 }, // 61 days back — outside 56-day window
        { day: "2026-06-01", score: 4 }, // 39 days back — inside
        { day: "2026-07-11", score: 4 }, // after today — dropped
      ],
      OPTS,
    );
    expect(s.count).toBe(1);
    expect(s.points[0].day).toBe("2026-06-01");
  });

  it("sorts points by day and builds an M…L path in chronological order", () => {
    const s = buildMoodSparkline(
      [
        { day: "2026-07-08", score: 2 },
        { day: "2026-07-06", score: 4 },
        { day: "2026-07-07", score: 3 },
      ],
      OPTS,
    );
    expect(s.points.map((p) => p.day)).toEqual(["2026-07-06", "2026-07-07", "2026-07-08"]);
    expect(s.path.startsWith("M ")).toBe(true);
    expect(s.path.match(/L /g)?.length).toBe(2);
  });

  it("emits a single M command (a lone dot, no line) for one check-in", () => {
    const s = buildMoodSparkline([{ day: "2026-07-05", score: 4 }], OPTS);
    expect(s.count).toBe(1);
    expect(s.path.includes("L")).toBe(false);
    expect(s.path.startsWith("M ")).toBe(true);
  });

  it("clamps an out-of-range score into the 1–5 band", () => {
    const s = buildMoodSparkline(
      [
        { day: "2026-07-10", score: 9 },
        { day: "2026-07-09", score: -2 },
      ],
      OPTS,
    );
    expect(s.points.find((p) => p.day === "2026-07-10")!.score).toBe(5);
    expect(s.points.find((p) => p.day === "2026-07-09")!.score).toBe(1);
  });

  it("ignores an unparseable day string", () => {
    const s = buildMoodSparkline(
      [
        { day: "not-a-day", score: 3 },
        { day: "2026-07-09", score: 3 },
      ],
      OPTS,
    );
    expect(s.count).toBe(1);
    expect(s.points[0].day).toBe("2026-07-09");
  });
});
