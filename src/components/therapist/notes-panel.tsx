import { Streamdown } from "streamdown";
import { relativeTime } from "@/lib/relative-time";
import type { TherapistNote } from "@/lib/therapist-notes";
import { NoteComposer } from "./note-composer";

const prose =
  "font-serif text-[14px] leading-[1.65] text-pretty text-foreground [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-[0.5em] [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5";

function NoteBody({ body, createdAt, tone }: { body: string; createdAt: Date; tone: string }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${tone}`}>
      <div className={prose}>
        <Streamdown>{body}</Streamdown>
      </div>
      <time suppressHydrationWarning className="mt-2 block text-[11px] tabular-nums text-muted-foreground/80">
        {relativeTime(createdAt)}
      </time>
    </div>
  );
}

// A titled note group — private or published — with its own clearly-labeled
// heading, existing notes, and a create form. The two kinds are visually
// distinct: private notes stay neutral (a personal margin note), published
// notes wear the warm accent panel the client sees on their side.
function NoteGroup({
  clientId,
  clientName,
  kind,
  heading,
  caption,
  emptyLine,
  notes,
}: {
  clientId: string;
  clientName: string;
  kind: "private" | "public";
  heading: string;
  caption: string;
  emptyLine: string;
  notes: TherapistNote[];
}) {
  const tone = kind === "public" ? "cp-panel" : "border-border/75 bg-card/50";
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-[14px] font-semibold text-foreground">{heading}</h3>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{caption}</p>
      </div>
      {notes.length === 0 ? (
        <p className="text-[12.5px] italic text-muted-foreground/80">{emptyLine}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {notes.map((note) => (
            <li key={note.id}>
              <NoteBody body={note.body} createdAt={note.createdAt} tone={tone} />
            </li>
          ))}
        </ul>
      )}
      <NoteComposer clientId={clientId} clientName={clientName} kind={kind} />
    </div>
  );
}

// AI guidance is versioned: the newest is what actually steers the AI, older
// versions are kept as a readable trail. The active one is marked; history is
// dimmed beneath it.
function AiGuidanceGroup({
  clientId,
  clientName,
  notes,
}: {
  clientId: string;
  clientName: string;
  notes: TherapistNote[];
}) {
  const ordered = [...notes].sort((a, b) => b.version - a.version);
  const [active, ...history] = ordered;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-[14px] font-semibold text-foreground">AI guidance</h3>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          The AI follows this only in shared conversations.
        </p>
      </div>

      {active ? (
        <div className="flex flex-col gap-2.5">
          <div className="rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-accent">
                <span aria-hidden className="size-1.5 rounded-full bg-accent" />
                Active · version {active.version}
              </span>
              <time suppressHydrationWarning className="text-[11px] tabular-nums text-muted-foreground/80">
                {relativeTime(active.createdAt)}
              </time>
            </div>
            <div className={prose}>
              <Streamdown>{active.body}</Streamdown>
            </div>
          </div>

          {history.length > 0 ? (
            <details className="group rounded-xl border border-border/70 bg-card/40 px-4 py-2.5">
              <summary className="cursor-pointer list-none text-[12px] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground">
                {history.length} earlier {history.length === 1 ? "version" : "versions"}
              </summary>
              <ul className="mt-3 flex flex-col gap-3 border-t border-border/60 pt-3">
                {history.map((note) => (
                  <li key={note.id} className="opacity-75">
                    <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-muted-foreground/80">
                      <span className="font-medium uppercase tracking-[0.05em]">Version {note.version}</span>
                      <time suppressHydrationWarning className="tabular-nums">{relativeTime(note.createdAt)}</time>
                    </div>
                    <div className={`${prose} text-[13px]`}>
                      <Streamdown>{note.body}</Streamdown>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : (
        <p className="text-[12.5px] italic text-muted-foreground/80">
          No guidance yet. What you write here steers the AI in {clientName}&apos;s shared
          conversations.
        </p>
      )}

      <NoteComposer clientId={clientId} clientName={clientName} kind="ai_instruction" />
    </div>
  );
}

// The three kinds of note a therapist keeps about one client, each visually
// distinct and plainly labeled so it's never ambiguous who can read what.
export function NotesPanel({
  clientId,
  clientName,
  notes,
}: {
  clientId: string;
  clientName: string;
  notes: TherapistNote[];
}) {
  const privateNotes = notes.filter((n) => n.kind === "private");
  const publicNotes = notes.filter((n) => n.kind === "public");
  const aiNotes = notes.filter((n) => n.kind === "ai_instruction");

  return (
    <section aria-labelledby="notes-heading" className="flex flex-col gap-7">
      <h2 id="notes-heading" className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        Your notes
      </h2>
      <NoteGroup
        clientId={clientId}
        clientName={clientName}
        kind="private"
        heading="Private notes"
        caption="Only you see these."
        emptyLine="No private notes yet."
        notes={privateNotes}
      />
      <NoteGroup
        clientId={clientId}
        clientName={clientName}
        kind="public"
        heading={`Notes to ${clientName}`}
        caption="Published — they can read these."
        emptyLine={`Nothing published to ${clientName} yet.`}
        notes={publicNotes}
      />
      <AiGuidanceGroup clientId={clientId} clientName={clientName} notes={aiNotes} />
    </section>
  );
}
