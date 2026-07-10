// Pure geometry for the mood sparkline — no DB, and the "today" reference is
// always injected, so the whole module is deterministic and unit-testable.
// Maps daily check-ins (a YYYY-MM-DD day + a 1–5 score) onto SVG coordinates
// within a fixed viewBox: x by how far back the day falls in the window, y by
// score (5 rides the top, 1 sits on the floor).

const MIN_SCORE = 1;
const MAX_SCORE = 5;
const MS_PER_DAY = 86_400_000;

export type SparklinePoint = { x: number; y: number; day: string; score: number };
export type MoodSparkline = { points: SparklinePoint[]; path: string; count: number };

export type SparklineOptions = {
  /** Right edge of the window, as YYYY-MM-DD (UTC). */
  today: string;
  /** Width of the window in days — 56 ≈ 8 weeks. */
  windowDays: number;
  width: number;
  height: number;
  padding?: number;
};

// Whole days since the Unix epoch (UTC) — differences are then exact integers,
// free of DST or local-offset drift. NaN for an unparseable day string.
function dayIndex(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / MS_PER_DAY);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildMoodSparkline(
  checkins: { day: string; score: number }[],
  { today, windowDays, width, height, padding = 6 }: SparklineOptions,
): MoodSparkline {
  const todayIdx = dayIndex(today);
  const startIdx = todayIdx - windowDays; // left edge of the window
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const scoreSpan = MAX_SCORE - MIN_SCORE;

  const points: SparklinePoint[] = checkins
    .flatMap((c) => {
      const idx = dayIndex(c.day);
      // Drop anything outside the window (or with an unparseable day).
      if (Number.isNaN(idx) || idx < startIdx || idx > todayIdx) return [];
      const score = Math.min(MAX_SCORE, Math.max(MIN_SCORE, c.score));
      const fx = windowDays === 0 ? 1 : (idx - startIdx) / windowDays;
      const fy = (score - MIN_SCORE) / scoreSpan; // 0 at the floor, 1 at the top
      return [
        {
          idx,
          day: c.day,
          score,
          x: round(padding + fx * innerW),
          y: round(padding + (1 - fy) * innerH), // invert: bright rides the top
        },
      ];
    })
    // Chronological, so the path threads the weeks left-to-right — then drop the
    // sort key, keeping only the public point shape.
    .sort((a, b) => a.idx - b.idx)
    .map((p) => ({ day: p.day, score: p.score, x: p.x, y: p.y }));

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return { points, path, count: points.length };
}

// The window's right edge. Kept out of any component body so the Date read
// isn't flagged as an impure render call (same reason deriveChatStats exists).
export function moodTodayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}
