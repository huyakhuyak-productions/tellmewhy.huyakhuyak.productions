import Link from "next/link";
import type { ClientOverview } from "@/lib/therapist-desk";
import { AttentionBadge } from "./attention-badge";

function since(linkedSince: Date | null): string {
  if (!linkedSince) return "Recently linked";
  return `With you since ${linkedSince.toLocaleDateString(undefined, { month: "long", year: "numeric" })}`;
}

function shared(count: number): string {
  if (count === 0) return "Nothing shared yet";
  return `${count} ${count === 1 ? "conversation" : "conversations"} shared`;
}

// The dashboard's roster. Each person is a card, not a table row — named in the
// serif the journal reserves for people, with the badges that say what's
// waiting inside. Ordered by need (crisis, then flags) upstream, so the ones
// who need reading rise to the top.
export function ClientList({ clients }: { clients: ClientOverview[] }) {
  return (
    <section aria-labelledby="clients-heading" className="flex flex-col gap-4">
      <h2 id="clients-heading" className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        The people you&apos;re alongside
      </h2>

      {clients.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 px-5 py-6">
          <p className="text-pretty font-serif text-[1.05rem] italic leading-relaxed text-muted-foreground">
            No one has linked with you yet. When someone invites you as their trusted person and
            accepts, they&apos;ll appear here.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {clients.map((client) => (
            <li key={client.clientId}>
              <Link
                href={`/therapist/clients/${client.clientId}`}
                aria-label={`Open ${client.clientName}`}
                className="group flex h-full flex-col gap-2.5 rounded-2xl border border-border/75 bg-card/55 p-5 outline-none transition-[border-color,background-color] duration-150 hover:border-accent/40 hover:bg-card/80 focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-serif text-[1.2rem] leading-tight text-foreground">
                    {client.clientName}
                  </span>
                  <svg viewBox="0 0 16 16" fill="none" className="mt-1 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden>
                    <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="flex flex-col gap-0.5 text-[12.5px] text-muted-foreground">
                  <span>{since(client.linkedSince)}</span>
                  <span className="tabular-nums">{shared(client.sharedCount)}</span>
                </div>
                {client.crisisCount > 0 || client.flagCount > 0 ? (
                  <div className="mt-0.5 flex flex-wrap gap-2">
                    {client.crisisCount > 0 ? <AttentionBadge kind="crisis" count={client.crisisCount} /> : null}
                    {client.flagCount > 0 ? <AttentionBadge kind="flag" count={client.flagCount} /> : null}
                  </div>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
