import { Streamdown } from "streamdown";
import { relativeTime } from "@/lib/relative-time";

// A published note a therapist left for the client — the same warm, tinted
// panel whether it surfaces under its conversation or on the Trust screen. A
// note is markdown a real person wrote, so it renders through Streamdown, and
// it stays readable even after a link is revoked (the server keeps serving it).
export function PublicNoteCard({
  therapistName,
  body,
  createdAt,
}: {
  therapistName: string;
  body: string;
  createdAt: Date;
}) {
  return (
    <div className="cp-panel rounded-2xl border px-5 py-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] font-medium text-foreground">{therapistName}</span>
        <time suppressHydrationWarning className="text-[11.5px] tabular-nums text-muted-foreground/80">
          {relativeTime(createdAt)}
        </time>
      </div>
      <div className="font-serif text-[1rem] leading-[1.7] text-pretty text-foreground [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-[0.6em] [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
        <Streamdown>{body}</Streamdown>
      </div>
    </div>
  );
}
