import { Streamdown } from "streamdown";
import { isLongForm } from "@/lib/message-form";

// Split raw user text into paragraphs on blank lines. User messages aren't
// markdown, so we render them literally — just grouped into readable blocks.
function paragraphs(text: string): string[] {
  const blocks = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return blocks.length > 0 ? blocks : [text];
}

export function MessageBubble({
  role,
  text,
  authorName,
  authorRelation = "your therapist",
}: {
  role: "user" | "assistant" | "therapist";
  text: string;
  /** Present only for therapist messages — the real person's display name. */
  authorName?: string;
  /** How the reader relates to a therapist author — "your therapist" on the
      client's side, "you" when a therapist reads their own words. */
  authorRelation?: string;
}) {
  const longForm = isLongForm(text);

  if (role === "user") {
    // Long reflection: a tinted panel with body-colored text (not a wall of
    // accent), so a paragraph of venting stays comfortable to read.
    if (longForm) {
      return (
        <div className="cp-panel animate-message-rise ml-auto max-w-[88%] text-pretty rounded-[18px] rounded-br-md border px-5 py-4 text-[0.975rem] leading-[1.7] text-foreground shadow-sm">
          {paragraphs(text).map((p, i) => (
            <p key={i} className="mb-[0.8em] last:mb-0">
              {p}
            </p>
          ))}
        </div>
      );
    }
    return (
      <div className="animate-message-rise ml-auto max-w-[85%] text-pretty rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[0.975rem] leading-relaxed text-accent-foreground shadow-sm">
        {text}
      </div>
    );
  }

  // A real person, your trusted therapist. Distinct from both the AI passage
  // (a serif letter with a "companion" rule) and the client's accent bubble: a
  // warm, solid human card with the person's name, left-aligned like someone
  // speaking to you. Rendered through Streamdown because a human may write a
  // link or a list. Long-form rules still decide bubble vs letter.
  if (role === "therapist") {
    const label = (
      <div className="mb-2 flex items-baseline gap-1.5">
        <span className="text-[0.8rem] font-semibold text-foreground">{authorName}</span>
        <span className="text-[0.72rem] text-muted-foreground">— {authorRelation}</span>
      </div>
    );
    if (longForm) {
      return (
        <div className="cp-panel animate-message-rise mr-auto max-w-[66ch] rounded-[18px] rounded-bl-md border px-5 py-4 shadow-sm">
          {label}
          <div className="font-serif text-[1.04rem] leading-[1.75] text-pretty text-foreground [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-[0.7em] [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5">
            <Streamdown>{text}</Streamdown>
          </div>
        </div>
      );
    }
    return (
      <div className="cp-panel animate-message-rise mr-auto max-w-[88%] rounded-[18px] rounded-bl-md border px-4 py-3 shadow-sm">
        {label}
        <div className="text-[0.975rem] leading-relaxed text-pretty text-foreground [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-background/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
          <Streamdown>{text}</Streamdown>
        </div>
      </div>
    );
  }

  // Long AI reflection: a serif passage marked by a quiet accent rule and a
  // small label — a considered letter, not a chat bubble.
  if (longForm) {
    return (
      <div className="cp-passage-rule animate-message-rise mr-auto max-w-[66ch] border-l-2 pl-6">
        <div className="mb-2.5 text-[0.66rem] uppercase tracking-[0.12em] text-muted-foreground">
          companion
        </div>
        <div className="font-serif text-[1.06rem] leading-[1.78] text-pretty [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.82em] [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-[0.85em] [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5">
          <Streamdown>{text}</Streamdown>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-message-rise mr-auto max-w-[88%] text-pretty rounded-2xl rounded-bl-md bg-muted px-4 py-3 text-[0.975rem] leading-relaxed shadow-sm [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-background/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
      <Streamdown>{text}</Streamdown>
    </div>
  );
}
