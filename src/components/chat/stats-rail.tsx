import Link from "next/link";
import type { ChatStats } from "@/lib/chat-stats";
import { MoodSparkline } from "./mood-sparkline";

export type { ChatStats };

// The mood trend feeding the "How the weeks have felt" panel — computed
// server-side (listMoodCheckins) so the rail never has to client-fetch it.
export type MoodTrend = { checkins: { day: string; score: number }[]; today: string };

// Live link + sharing summary for the (formerly placeholder) trusted-person
// panel. Computed server-side so the rail never has to fetch it.
export type TherapistRailState = {
  state: "none" | "invited" | "active";
  therapistName: string | null;
  sharedCount: number;
};

// A kept line, trimmed server-side for the rail's peek. The chat page clamps the
// body to 140 chars and hands over the three newest.
export type RailNote = { id: string; body: string; createdAt: Date };

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/75 bg-card/55 p-4">{children}</div>
  );
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span className="text-[13px] font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

// The trusted-person panel — real now, not a "Phase 2" placeholder. A single
// calm summary of the connection and how much is shared, and a way through to
// the full Trust screen. The whole card is the link, so reaching sharing
// controls is one quiet click from the reading rail.
function TherapistPanel({ therapist }: { therapist: TherapistRailState }) {
  const shared =
    therapist.sharedCount === 1 ? "1 conversation shared" : `${therapist.sharedCount} conversations shared`;

  const headline =
    therapist.state === "active"
      ? (therapist.therapistName ?? "Your trusted person")
      : therapist.state === "invited"
        ? "Invitation waiting"
        : "No trusted person yet";

  const sub =
    therapist.state === "active"
      ? shared
      : therapist.state === "invited"
        ? "Waiting for them to accept"
        : "Invite one person you trust to review what you choose.";

  const cta =
    therapist.state === "active"
      ? "Manage sharing"
      : therapist.state === "invited"
        ? "View invitation"
        : "Invite a trusted person";

  return (
    <Link
      href="/trust"
      aria-label="Trust and sharing"
      className="group block rounded-2xl border border-border/75 bg-card/55 p-4 outline-none transition-[border-color,background-color] duration-150 hover:border-accent/40 hover:bg-card/80 focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <div className="flex items-center gap-2">
        <span
          className={`size-2 shrink-0 rounded-full ${therapist.state === "active" ? "bg-accent" : "bg-crisis-muted"}`}
          aria-hidden
        />
        <span className="min-w-0 truncate text-[13px] font-semibold">{headline}</span>
      </div>
      <p className="mt-2 text-[11.5px] leading-[1.55] text-muted-foreground">{sub}</p>
      <span className="mt-2.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-accent">
        {cta}
        <svg viewBox="0 0 16 16" fill="none" className="size-3 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden>
          <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </Link>
  );
}

export function StatsRail({
  stats,
  therapist,
  mood,
  notes,
  className = "",
}: {
  stats: ChatStats;
  therapist: TherapistRailState;
  mood: MoodTrend;
  notes: RailNote[];
  className?: string;
}) {
  const memberSince = stats.memberSince.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <aside
      className={`cp-edge flex flex-col gap-3.5 overflow-y-auto px-4 pb-5 pt-12 lg:border-l ${className}`}
    >
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        Alongside you
      </div>

      {/* Real, quiet — the only live numbers on the rail. */}
      <Panel>
        <div className="text-[13px] font-semibold">This chapter</div>
        <div className="mt-1.5 divide-y divide-border/60">
          <StatLine label="This week" value={String(stats.thisWeek)} />
          <StatLine label="In total" value={String(stats.total)} />
          <StatLine label="Here since" value={memberSince} />
        </div>
      </Panel>

      {/* Real now: the trusted-person connection and how much is shared. */}
      <TherapistPanel therapist={therapist} />

      {/* Live now: the mood trend, drawn from the client's own check-ins. */}
      <Panel>
        <div className="text-[13px] font-semibold">How the weeks have felt</div>
        <MoodSparkline checkins={mood.checkins} today={mood.today} />
      </Panel>

      {/* Live now: the client's own kept lines — private, always. */}
      <Link
        href="/notes"
        aria-label="Notes to your future self"
        className="group block rounded-2xl border border-border/75 bg-card/55 p-4 outline-none transition-[border-color,background-color] duration-150 hover:border-accent/40 hover:bg-card/80 focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className="text-[13px] font-semibold">Notes to your future self</span>
        {notes.length === 0 ? (
          <p className="mt-2 text-[11.5px] leading-[1.55] text-muted-foreground">
            Keep a line worth remembering — it&apos;ll wait here for the next hard night.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {notes.map((n) => (
              <li key={n.id} className="truncate font-serif text-[12px] italic leading-[1.6] text-muted-foreground">
                {n.body}
              </li>
            ))}
          </ul>
        )}
        <span className="mt-2.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-accent">
          {notes.length === 0 ? "Write the first one" : "All your notes"}
          <svg viewBox="0 0 16 16" fill="none" className="size-3 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden>
            <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </Link>
    </aside>
  );
}
