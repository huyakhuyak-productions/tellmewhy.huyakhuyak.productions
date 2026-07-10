import { buildMoodSparkline } from "@/lib/mood-sparkline";

const WIDTH = 240;
const HEIGHT = 44;
const WINDOW_DAYS = 56; // ~8 weeks

// The "How the weeks have felt" trend — pure SVG, no packages. Each check-in is
// a point of light (the same dot the home-screen check-in speaks in); a faint
// accent line threads them in date order, and the most recent one carries a
// soft halo, so the eye lands on where the weeks stand now. When there's
// nothing yet it keeps the panel's honest placeholder copy rather than drawing
// an empty axis. `emptyLine` lets the therapist's shared-trend panel speak in
// the third person ("No check-ins in this window yet.") while the client's own
// rail keeps its first-person default — the geometry and dots are shared.
export function MoodSparkline({
  checkins,
  today,
  emptyLine = "A mood trend will take shape here as you check in over time.",
}: {
  checkins: { day: string; score: number }[];
  today: string;
  emptyLine?: string;
}) {
  const { points, path, count } = buildMoodSparkline(checkins, {
    today,
    windowDays: WINDOW_DAYS,
    width: WIDTH,
    height: HEIGHT,
  });

  if (count === 0) {
    return (
      <>
        <div aria-hidden className="mt-3 h-11 rounded-lg border border-dashed border-border/70" />
        <p className="mt-2 text-[11.5px] leading-[1.55] text-muted-foreground">{emptyLine}</p>
      </>
    );
  }

  const latest = points[points.length - 1];
  const label = `Mood over the last 8 weeks, ${count} ${count === 1 ? "check-in" : "check-ins"}`;

  return (
    <figure className="mt-3">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={label}
        className="h-11 w-full overflow-visible"
        preserveAspectRatio="none"
      >
        {points.length > 1 ? (
          <path
            d={path}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.55}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {points.map((p) => (
          <circle key={p.day} cx={p.x} cy={p.y} r={2} fill="var(--accent)" />
        ))}
        {/* Where the weeks stand now — a quiet halo on the most recent point. */}
        <circle cx={latest.x} cy={latest.y} r={4.5} fill="var(--accent)" opacity={0.18} />
      </svg>
      {/* Visual-only: the SVG's aria-label already announces the count, so
          keep this out of the accessibility tree rather than saying it twice. */}
      <figcaption aria-hidden className="mt-2 text-[11.5px] leading-[1.55] text-muted-foreground">
        <span className="tabular-nums">{count}</span>{" "}
        {count === 1 ? "check-in" : "check-ins"} over the last 8 weeks.
      </figcaption>
    </figure>
  );
}
