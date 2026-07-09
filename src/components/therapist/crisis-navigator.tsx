// A quiet, Telegram-search-style way to move crisis-to-crisis through a long
// shared conversation: two arrows and an "X/N crisis" readout. Warm urgency —
// the same amber the attention queue speaks in — never an alarm-red jolt.
// Presentational only: the reading view owns which crisis is current, does the
// scroll, and lands the gentle highlight; this pill just shows position and
// asks to step.
export function CrisisNavigator({
  index,
  total,
  landed,
  onPrev,
  onNext,
}: {
  /** 0-based position of the current crisis; shown to the reader as index+1. */
  index: number;
  total: number;
  /** Has the reader stepped at least once? Before the first step there is
      nothing behind position 1, so Previous stays disabled. */
  landed: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const prevDisabled = landed ? index === 0 : true;
  const nextDisabled = landed ? index === total - 1 : false;

  return (
    <div className="sticky top-4 z-20 -mt-1 flex justify-center">
      <div className="inline-flex items-center gap-1 rounded-full border border-crisis-border bg-crisis/95 px-1.5 py-1 text-crisis-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_14px_-6px_var(--crisis-glow)] backdrop-blur-sm">
        <StepButton label="Previous crisis message" disabled={prevDisabled} onClick={onPrev} direction="up" />
        <StepButton label="Next crisis message" disabled={nextDisabled} onClick={onNext} direction="down" />
        <p className="flex items-baseline gap-1 px-1.5 pr-2.5 text-[12px] font-medium">
          <span aria-live="polite" className="tabular-nums">
            {index + 1}/{total}
          </span>
          <span className="text-crisis-muted">crisis</span>
        </p>
      </div>
    </div>
  );
}

function StepButton({
  label,
  direction,
  disabled,
  onClick,
}: {
  label: string;
  direction: "up" | "down";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-full text-crisis-muted outline-none transition-[color,background-color,scale] duration-150 hover:bg-crisis-muted/15 hover:text-crisis-foreground focus-visible:ring-2 focus-visible:ring-crisis-muted/50 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-35"
    >
      <svg viewBox="0 0 16 16" fill="none" aria-hidden className="size-4">
        {direction === "up" ? (
          <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );
}
