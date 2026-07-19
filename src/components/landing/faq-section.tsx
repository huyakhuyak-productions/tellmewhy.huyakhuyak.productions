// The FAQ copy, answered honestly from the README's Privacy Model. Exported as
// a typed list so Task 11's FAQPage JSON-LD can mirror it 1:1 — the questions
// and answers a reader sees are exactly the ones a search engine is told about.
export const LANDING_FAQ: { question: string; answer: string }[] = [
  {
    question: "Is this end-to-end encrypted?",
    answer:
      "No, and we won't pretend otherwise. Your messages are encrypted at rest with a key that's yours, so a database breach can't read them. But the AI has to read your words to reply, which means plaintext briefly exists in memory on our servers during inference. It's discarded the moment the reply is done, and only the encrypted version is ever stored. The encryption protects against database breaches and backup leaks — not against the processing that makes a reply possible.",
  },
  {
    question: "Can my therapist read everything I write?",
    answer:
      "No. Nothing is shared by default. You share one conversation at a time from its header, and you can revoke any share instantly — they lose access to past and future messages alike. A trusted person only ever sees the conversations you've actively chosen to share, plus whatever else you deliberately turn on, like a mood trend or a single thought-record entry.",
  },
  {
    question: "Is this a crisis service?",
    answer:
      "No. tellmewhy is not a medical device and not a substitute for professional care or emergency services. If it detects a crisis signal it surfaces hotline resources — 988 in the US, findahelpline.com internationally — and crisis-flagged messages are surfaced to your trusted person's attention queue, in the conversations you've chosen to share with them, the next time they look. It doesn't push an alert. In an emergency, please contact your local emergency services.",
  },
  {
    question: "What happens to my data if there's a breach?",
    answer:
      "Message bodies, conversation titles, and folder names are all encrypted at rest, so a breach exposes no content. It would reveal metadata — when conversations happened, which messages were flagged as crisis-level, and who is linked to whom — but never a single word of what was said.",
  },
  {
    question: "How does deleting my account work?",
    answer:
      "It's self-serve from your account settings — password plus a clear acknowledgment — and it happens in one stroke, with no waiting period: your encryption key is destroyed, so nothing encrypted can ever be read again by anyone, including us, and every row you own is purged. Two things survive by design: an audit line of ids and timestamps (no content, ever), and, if you'd linked a therapist, the notes they wrote about you — those are encrypted with their key, not yours, and were always their record. One honest caveat — a database backup taken before the key is destroyed still holds the wrapped key, so it stays readable until it ages out of backup retention or the master key is rotated.",
  },
  {
    question: "What if I forget my password?",
    answer:
      "Reset it by email. You'll get a link and nothing else — no name, no message content, nothing an inbox thief learns beyond the fact that this address has an account here — then you set a new password and every other session is signed out. A reset restores your access without losing any data: your conversations are still there, still yours to read. What it cannot do is hand your words to anyone else — your key is wrapped by our server, not your password, so recovery proves it's your inbox; it never decrypts your content for a stranger, or for us. One caveat: we don't verify email at sign-up, so use an address you actually control.",
  },
  {
    question: "Does the AI provider train on my conversations?",
    answer:
      "Every AI call routes through OpenRouter with per-request data collection denied, and the account's data policy must be configured to exclude logging and training providers before anything real runs on it. Your conversations are used to write you a reply and nothing else.",
  },
];

// Native <details> disclosure — accessible and server-renderable with zero
// client JavaScript. The default marker is hidden in favor of a chevron that
// rotates open, matching the app's quiet, hairline-ruled reading surfaces.
export function FaqSection() {
  return (
    <section className="flex w-full flex-col gap-6" aria-labelledby="faq-heading">
      <div className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          Questions
        </span>
        <h2
          id="faq-heading"
          className="text-balance font-serif text-[1.55rem] leading-[1.2] tracking-[-0.01em] md:text-[1.8rem]"
        >
          The honest answers
        </h2>
      </div>

      <ul className="flex flex-col">
        {LANDING_FAQ.map(({ question, answer }) => (
          <li key={question} className="border-t border-border/70 last:border-b">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm py-4 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 [&::-webkit-details-marker]:hidden">
                <span className="font-serif text-[1.05rem] leading-snug text-foreground transition-colors group-focus-within:text-accent">
                  {question}
                </span>
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                >
                  <path
                    d="M4 6.5 8 10.5l4-4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </summary>
              <p className="max-w-prose text-pretty pb-5 text-[14.5px] leading-relaxed text-muted-foreground">
                {answer}
              </p>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
