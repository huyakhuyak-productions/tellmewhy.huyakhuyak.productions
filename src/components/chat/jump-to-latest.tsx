// The way back down. Shown only once new words have landed below a reader who
// scrolled up mid-reply (see useStickToBottom's `showJump`) — never while the
// column is simply idle. Docked just above the composer off the same measured
// `--composer-height` the crisis card uses, so it clears the form at any size.
//
// Stays mounted either way so the pill can glide in and out: while hidden it
// is `inert` (out of the tab order) and `aria-hidden` (out of the a11y tree),
// and `invisible` so a hit-test never lands on the transparent shape.
//
// Using it hides it, and an inert element cannot hold focus — so a keyboard
// activation (`detail === 0`, unlike a pointer click's 1) is reported to the
// caller, who hands focus somewhere sensible instead of letting it fall to
// the body.
export function JumpToLatest({
  visible,
  onJump,
}: {
  visible: boolean;
  onJump: (viaKeyboard: boolean) => void;
}) {
  return (
    <button
      type="button"
      inert={!visible}
      aria-hidden={!visible || undefined}
      onClick={(e) => onJump(e.detail === 0)}
      className={`absolute bottom-[calc(var(--composer-height,69px)+14px)] inset-x-0 z-20 mx-auto flex min-h-10 w-fit items-center gap-1.5 rounded-full border bg-background/90 py-2 pr-4 pl-3.5 text-[13px] text-foreground touch-manipulation shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_-8px_rgba(0,0,0,0.28)] outline-none backdrop-blur-md ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.96] motion-safe:transition-[opacity,translate,visibility] motion-safe:duration-200 lg:bottom-[calc(var(--composer-height,81px)+14px)] ${
        visible ? "visible translate-y-0 opacity-100" : "pointer-events-none invisible translate-y-1.5 opacity-0"
      }`}
    >
      <svg viewBox="0 0 16 16" fill="none" className="size-3.5" aria-hidden>
        <path
          d="M8 3v10M4 9l4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Jump to latest
    </button>
  );
}
