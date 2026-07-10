import Link from "next/link";

export type HomeAssignment = { id: string; instruction: string; therapistName: string | null };

// The home-screen assignment surface: a calm band of the trusted person's active
// thought-record assignments, each a card that opens straight into its worksheet
// on /exercises. Rendered only when there's at least one — the home screen stays
// quiet otherwise. Presentational and server-rendered (just links).
export function AssignmentCards({ assignments }: { assignments: HomeAssignment[] }) {
  return (
    <section
      aria-label="Assignments from your therapist"
      className="flex w-full max-w-[600px] flex-col gap-2.5"
    >
      <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Waiting for you
      </h2>
      {assignments.map((a) => (
        <Link
          key={a.id}
          href={`/exercises?start=${a.id}`}
          className="group flex items-center gap-3 rounded-2xl border bg-card/60 px-5 py-4 outline-none transition-[border-color,transform] duration-150 hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.99]"
        >
          <span aria-hidden className="mt-0.5 size-1.5 shrink-0 self-start rounded-full bg-accent" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-accent/90">
              {a.therapistName ? `From ${a.therapistName}` : "From your therapist"}
            </span>
            <span className="text-pretty font-serif text-[0.98rem] italic leading-relaxed text-foreground">
              {a.instruction}
            </span>
          </span>
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className="size-4 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-accent"
            aria-hidden
          >
            <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      ))}
    </section>
  );
}
