import { MoodSparkline } from "@/components/chat/mood-sparkline";

// The client's mood trend, as the therapist sees it — the SAME sparkline the
// client watches on their own rail, so both sides read one shared picture. This
// panel is only ever rendered when the client has the sharing toggle on (the
// page treats a 404 as an absent panel, indistinguishable from a client who
// never enabled it), so its mere presence already says "they chose to share
// this". "Shared by {clientName}" names that consent plainly. Scores and days
// only — a check-in's private note never reaches this surface.
export function MoodTrend({
  clientName,
  trend,
  today,
}: {
  clientName: string;
  trend: { day: string; score: number }[];
  today: string;
}) {
  return (
    <section aria-labelledby="mood-heading" className="flex flex-col gap-4">
      <h2
        id="mood-heading"
        className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
      >
        How the weeks have felt
      </h2>
      <div className="rounded-2xl border border-border/75 bg-card/55 p-4">
        <p className="text-[12px] text-muted-foreground">
          Shared by <span className="font-medium text-foreground">{clientName}</span>
        </p>
        <MoodSparkline
          checkins={trend}
          today={today}
          emptyLine="No check-ins in this window yet."
        />
      </div>
    </section>
  );
}
