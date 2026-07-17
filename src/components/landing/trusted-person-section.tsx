// The optional trusted-person layer. Copy mirrors the README's "Linking a
// trusted person" section — one person, per-conversation sharing, human-labeled
// writing, a plain audit trail, and granular opt-ins that each revoke on their
// own.
const POINTS: { lead: string; body: string }[] = [
  {
    lead: "One person, only what you share.",
    body: "Link a therapist — or anyone you trust — to read only the conversations you hand them, one at a time. Revoke a share, or the whole link, and their access ends immediately.",
  },
  {
    lead: "Always in their own name.",
    body: "When your trusted person writes to you, it's labeled as them — never blurred into the AI. They can leave standing guidance that shapes how the AI responds in the conversations you've shared.",
  },
  {
    lead: "A plain record of what they did.",
    body: "A quiet audit trail logs every time they read, marked their place, wrote to you, or published a note — each with a timestamp — so you always know what happened, even when you weren't looking.",
  },
  {
    lead: "Mood and homework, opt-in by opt-in.",
    body: "Share a mood trend or an individual thought-record entry only if you choose to. Each is a separate, revocable decision — and your private notes never leave your view.",
  },
];

export function TrustedPersonSection() {
  return (
    <section className="flex w-full flex-col gap-7" aria-labelledby="trusted-heading">
      <div className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          Optional, and yours to end
        </span>
        <h2
          id="trusted-heading"
          className="text-balance font-serif text-[1.6rem] leading-[1.2] tracking-[-0.01em] md:text-[1.95rem]"
        >
          A trusted person, if you want one
        </h2>
        <p className="max-w-prose text-pretty text-[14.5px] leading-relaxed text-muted-foreground">
          Some things are easier to face with someone in your corner. tellmewhy lets you invite one
          — entirely at your discretion, entirely revocable.
        </p>
      </div>

      <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        {POINTS.map(({ lead, body }) => (
          <li key={lead} className="flex flex-col gap-1.5">
            <h3 className="font-serif text-[1.05rem] leading-snug text-foreground">{lead}</h3>
            <p className="text-pretty text-[14px] leading-relaxed text-muted-foreground">{body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
