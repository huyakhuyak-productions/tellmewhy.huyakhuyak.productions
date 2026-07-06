import type { ChatStats } from "@/lib/chat-stats";

export type { ChatStats };

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/75 bg-card/55 p-4">{children}</div>
  );
}

function SoonPill({ phase }: { phase: string }) {
  return (
    <span className="ml-auto whitespace-nowrap rounded-full bg-accent/[0.14] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-accent">
      {phase}
    </span>
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

export function StatsRail({
  stats,
  className = "",
}: {
  stats: ChatStats;
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

      {/* Everything below is honestly a placeholder — labeled, never faked. */}
      <Panel>
        <div className="flex items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-crisis-muted" aria-hidden />
          <span className="text-[13px] font-semibold">Listener review</span>
          <SoonPill phase="Phase 2" />
        </div>
        <p className="mt-2 text-[11.5px] leading-[1.55] text-muted-foreground">
          A licensed listener will be able to gently review a session you choose to share.
        </p>
      </Panel>

      <Panel>
        <div className="flex items-center">
          <span className="text-[13px] font-semibold">How the weeks have felt</span>
          <SoonPill phase="Phase 2" />
        </div>
        <div
          aria-hidden
          className="mt-3 h-11 rounded-lg border border-dashed border-border/70"
        />
        <p className="mt-2 text-[11.5px] leading-[1.55] text-muted-foreground">
          A mood trend will take shape here as you check in over time.
        </p>
      </Panel>

      <Panel>
        <div className="flex items-center">
          <span className="text-[13px] font-semibold">Notes to your future self</span>
          <SoonPill phase="Phase 3" />
        </div>
        <p className="mt-2 text-[11.5px] leading-[1.55] text-muted-foreground">
          Lines worth remembering will be set aside here for the next hard night.
        </p>
      </Panel>
    </aside>
  );
}
