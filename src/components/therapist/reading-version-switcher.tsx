// The version arrows under a branched message in the THERAPIST reading view —
// ‹ n/m › between siblings, same visual language as the client's switcher but a
// deliberately different contract: navigation here is VIEW-LOCAL. The therapist
// is reading, not authoring; stepping versions must never POST a new active leaf
// or touch what the client sees. So this control is purely presentational — it
// reports which arrow was pressed and the reading view moves its own local
// `viewLeafId`. (The client's <VersionSwitcher> owns the server-driven variant;
// they share the look, not the behaviour, so they stay separate components.)
export function ReadingVersionSwitcher({
  index,
  count,
  onPrev,
  onNext,
}: {
  /** 0-based position of the displayed version among its siblings. */
  index: number;
  /** How many versions the set holds (always > 1 where this renders). */
  count: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const atStart = index <= 0;
  const atEnd = index >= count - 1;
  const arrowClass =
    "flex size-6 items-center justify-center rounded-md text-muted-foreground/70 outline-none transition-[color,transform] duration-150 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.94] disabled:pointer-events-none disabled:opacity-30";

  return (
    <div className="mt-1 flex items-center gap-1 pr-1 text-[11px] text-muted-foreground/70">
      <button
        type="button"
        aria-label="Previous version"
        onClick={onPrev}
        disabled={atStart}
        className={arrowClass}
      >
        <svg viewBox="0 0 16 16" fill="none" className="size-3.5" aria-hidden>
          <path
            d="M10 3.5 5.5 8l4.5 4.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <span aria-hidden className="min-w-[2.2rem] text-center tabular-nums">
        {index + 1}/{count}
      </span>
      <span className="sr-only">
        Version {index + 1} of {count}
      </span>
      <button
        type="button"
        aria-label="Next version"
        onClick={onNext}
        disabled={atEnd}
        className={arrowClass}
      >
        <svg viewBox="0 0 16 16" fill="none" className="size-3.5" aria-hidden>
          <path
            d="M6 3.5 10.5 8 6 12.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
