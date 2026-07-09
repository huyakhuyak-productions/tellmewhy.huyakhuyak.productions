// The two kinds of "look at this" the desk speaks: a crisis (warm, grounding —
// never a red alarm) and a client-raised flag (the accent). Used both as a
// count badge on client/conversation rows and as a bare marker on an
// individual message in the reading view.
export function AttentionBadge({
  kind,
  count,
  className = "",
}: {
  kind: "crisis" | "flag";
  /** Omit for a message-level marker; provide to show a running total. */
  count?: number;
  className?: string;
}) {
  const tone =
    kind === "crisis"
      ? "border-crisis-border bg-crisis text-crisis-foreground"
      : "border-accent/25 bg-accent/[0.1] text-accent";
  // Message-level marker: just the kind. Count badge: a pluralized total —
  // "crisis"/"crises", "flag"/"flags".
  const text =
    count === undefined
      ? kind === "crisis"
        ? "Crisis"
        : "Flagged"
      : kind === "crisis"
        ? `${count} ${count === 1 ? "crisis" : "crises"}`
        : `${count} ${count === 1 ? "flag" : "flags"}`;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium tabular-nums ${tone} ${className}`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${kind === "crisis" ? "bg-crisis-muted" : "bg-accent"}`} />
      {text}
    </span>
  );
}
