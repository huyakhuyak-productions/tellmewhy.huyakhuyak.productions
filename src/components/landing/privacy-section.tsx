// The privacy promise — the page's signature. Radical candor is the brand's
// boldest move, so the honest "not end-to-end encryption" caveat gets its own
// accent-ruled passage instead of being buried. Every claim mirrors the
// README's Privacy Model; nothing here is invented.
const PROMISES: { lead: string; body: string }[] = [
  {
    lead: "Encrypted at rest, for you alone.",
    body: "Every message, conversation title, and folder name is encrypted with a key that belongs to you. Without it, nothing is readable — even with the database in hand.",
  },
  {
    lead: "Plaintext lives only in memory.",
    body: "Your words are decrypted only while the AI is composing a reply, then discarded. Once inference is done, only the ciphertext remains.",
  },
  {
    lead: "No-logging providers only.",
    body: "Every AI call denies data collection per request; the account's data policy must be set to exclude logging and training providers before anything real runs on it.",
  },
  {
    lead: "Nothing is shared by default.",
    body: "No one sees your conversations unless you choose to — one at a time, and revocable in an instant, to past and future messages alike.",
  },
  {
    lead: "Analytics that can't read anything.",
    body: "We count page views with our own self-hosted, cookieless analytics — paths and visits, kept on our own server, shared with no one. It sets no cookies and never sees a word you write.",
  },
  {
    lead: "Deletion means crypto-shredding.",
    body: "Delete your account from its settings and it happens at once — your key is destroyed, so nothing encrypted can ever be read again, by anyone, including us, and every row you own is purged. A linked therapist keeps the notes they wrote, plus a name-only marker that you left; those were always their record, not yours.",
  },
  {
    lead: "A forgotten password locks nothing away.",
    body: "Reset it by email and you're back in — your conversations are still there, still yours. The reset restores access, not a backdoor: your key is wrapped by our server, not your password, so it never decrypts a word, and it's no way for us to read them either. Recovery trusts your inbox, so keep that address yours.",
  },
];

export function PrivacySection() {
  return (
    <section className="flex w-full flex-col gap-7" aria-labelledby="privacy-heading">
      <div className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          What stays private
        </span>
        <h2
          id="privacy-heading"
          className="text-balance font-serif text-[1.6rem] leading-[1.2] tracking-[-0.01em] md:text-[1.95rem]"
        >
          Built so your words stay yours
        </h2>
      </div>

      <ul className="flex flex-col">
        {PROMISES.map(({ lead, body }) => (
          <li
            key={lead}
            className="flex flex-col gap-1 border-t border-border/70 py-4 last:border-b"
          >
            <h3 className="font-serif text-[1.05rem] leading-snug text-foreground">{lead}</h3>
            <p className="max-w-prose text-pretty text-[14.5px] leading-relaxed text-muted-foreground">
              {body}
            </p>
          </li>
        ))}
      </ul>

      {/* The candid caveat, set apart by an accent rule — the one thing most
          products in this space quietly avoid saying out loud. */}
      <div className="cp-passage-rule border-l-2 pl-5">
        <p className="max-w-prose text-pretty font-serif text-[1.05rem] italic leading-relaxed text-muted-foreground">
          This is not end-to-end encryption, and we won&apos;t claim it is. The AI has to read your
          words to reply, so plaintext briefly exists on our servers during inference. The
          encryption protects against database breaches and backup leaks — not against the
          processing that makes a reply possible.
        </p>
      </div>
    </section>
  );
}
