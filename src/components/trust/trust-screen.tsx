"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AuditAction } from "@/lib/audit";
import { type AuditActor, describeAuditAction, isClientAction } from "@/lib/audit-copy";
import { relativeTime } from "@/lib/relative-time";
import { stopSharingConversation } from "@/lib/sharing-client";
import type { Departure } from "@/lib/therapist-links";
import { DepartureNotices } from "@/components/departure-notices";
import { PublicNoteCard } from "@/components/public-note-card";

export type TrustLinkState =
  | { kind: "none" }
  | { kind: "invited"; linkId: string }
  | { kind: "active"; linkId: string; therapistName: string };

export type SharedConversation = { id: string; title: string };
export type TrustAuditRow = {
  id: string;
  action: AuditAction;
  therapistName: string | null;
  // Resolved server-side (the client's own id never needs to leave the
  // server just to answer "who did this") — see resolveAuditActor.
  actor: AuditActor;
  title: string | null;
  createdAt: Date;
};
export type TrustNote = { id: string; body: string; therapistName: string; createdAt: Date };

// A quiet section wrapper — an eyebrow label over its content, staggered in.
function Zone({
  label,
  children,
  delay = 0,
}: {
  label: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <section className="animate-message-rise flex flex-col gap-3" style={{ animationDelay: `${delay}ms` }}>
      <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </h2>
      {children}
    </section>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border bg-card/60 p-5 ${className}`}>{children}</div>
  );
}

export function TrustScreen({
  link,
  departures,
  shared,
  audit,
  notes,
  moodShared,
}: {
  link: TrustLinkState;
  /** Trusted people who deleted their account, unacknowledged. */
  departures: Departure[];
  shared: SharedConversation[];
  audit: TrustAuditRow[];
  notes: TrustNote[];
  /** Whether the mood trend is currently shared on the active link. */
  moodShared: boolean;
}) {
  const router = useRouter();

  // The raw invite URL is shown exactly once — the moment it's minted here.
  // The server only ever knows its hash, so a pending invite loaded on a later
  // visit can be cancelled but not re-copied (that's the honest state).
  const [invitePath, setInvitePath] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [busyLink, setBusyLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [unsharing, setUnsharing] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [moodOn, setMoodOn] = useState(moodShared);
  const [moodBusy, setMoodBusy] = useState(false);
  const [moodError, setMoodError] = useState<string | null>(null);

  const inviteUrl =
    invitePath && typeof window !== "undefined" ? `${window.location.origin}${invitePath}` : invitePath;

  async function generateInvite() {
    if (inviting) return;
    setInviteError(null);
    setInviting(true);
    try {
      const res = await fetch("/api/links/invite", { method: "POST" });
      const body: { path?: string; error?: string } | null = await res.json().catch(() => null);
      if (!res.ok || !body?.path) {
        setInviteError(body?.error ?? "Couldn't create an invite just now — try again.");
        return;
      }
      setInvitePath(body.path);
      router.refresh();
    } catch {
      setInviteError("Couldn't create an invite just now — try again.");
    } finally {
      setInviting(false);
    }
  }

  async function copyLink() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (insecure context, denied permission) — the field is
      // selectable, so the person can still copy by hand. No alarm.
    }
  }

  async function revoke(linkId: string) {
    if (busyLink) return;
    setLinkError(null);
    setBusyLink(true);
    try {
      const res = await fetch(`/api/links/${linkId}`, { method: "DELETE" });
      if (!res.ok) {
        setLinkError("Couldn't do that just now — try again.");
        return;
      }
      setInvitePath(null);
      setConfirmingEnd(false);
      router.refresh();
    } catch {
      setLinkError("Couldn't do that just now — try again.");
    } finally {
      setBusyLink(false);
    }
  }

  async function toggleMoodSharing() {
    if (moodBusy) return;
    const next = !moodOn;
    setMoodError(null);
    setMoodOn(next); // optimistic
    setMoodBusy(true);
    try {
      const res = await fetch("/api/mood/sharing", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        setMoodOn(!next); // revert
        setMoodError("Couldn't change that just now — try again.");
        return;
      }
      router.refresh();
    } catch {
      setMoodOn(!next); // revert
      setMoodError("Couldn't change that just now — try again.");
    } finally {
      setMoodBusy(false);
    }
  }

  async function stopSharing(id: string) {
    if (unsharing) return;
    setShareError(null);
    setUnsharing(id);
    const ok = await stopSharingConversation(id);
    setUnsharing(null);
    if (!ok) {
      setShareError("Couldn't stop sharing just now — try again.");
      return;
    }
    router.refresh();
  }

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-[640px] flex-col gap-10 px-5 pb-20 pt-8 md:pt-14">
      <div aria-hidden className="ambient-room" />

      <div className="animate-message-rise flex flex-col gap-3">
        <Link
          href="/chat"
          className="inline-flex w-fit items-center gap-1.5 rounded-full py-1 pr-2 text-[12.5px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden>
            <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to your conversations
        </Link>
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Trust &amp; sharing
        </span>
        <h1 className="text-balance font-serif text-[1.9rem] font-medium leading-[1.2] tracking-[-0.01em]">
          What stays yours, and what you share
        </h1>
        <p className="text-pretty font-serif text-[1.05rem] italic leading-relaxed text-muted-foreground">
          Everything here is private by default. You decide what a trusted person
          can see, and you can change your mind at any time.
        </p>
      </div>

      {/* Zone 1 — the connection itself. A departed trusted person is
          farewelled here first, above whatever the link state now is. */}
      <Zone label="Your trusted person" delay={40}>
        <DepartureNotices departures={departures} side="client" />
        {link.kind === "active" ? (
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[0.95rem] font-medium text-foreground">{link.therapistName}</p>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  Can review only the conversations you share below.
                </p>
              </div>
              {confirmingEnd ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => revoke(link.linkId)}
                    disabled={busyLink}
                    className="rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-accent-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.97] disabled:opacity-50"
                  >
                    {busyLink ? "Ending…" : "Yes, end it"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingEnd(false)}
                    disabled={busyLink}
                    className="rounded-lg px-3 py-2 text-[12.5px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    Keep it
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingEnd(true)}
                  className="shrink-0 rounded-lg border px-3 py-2 text-[12.5px] text-muted-foreground outline-none transition-colors duration-150 hover:border-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97]"
                >
                  End connection
                </button>
              )}
            </div>
            {confirmingEnd ? (
              <p className="mt-3 font-serif text-[0.9rem] italic leading-relaxed text-muted-foreground">
                Ending this stops all sharing and closes their access. Notes they
                already left you stay.
              </p>
            ) : null}
            {linkError ? (
              <p role="alert" className="mt-3 font-serif text-[12.5px] italic text-accent">
                {linkError}
              </p>
            ) : null}
          </Card>
        ) : link.kind === "invited" ? (
          <Card>
            <p className="text-[0.95rem] font-medium text-foreground">Your invitation is waiting</p>
            <p className="mt-1 text-pretty text-[12.5px] leading-relaxed text-muted-foreground">
              {invitePath
                ? "Share the link below with the person you trust. It works once, and expires in 7 days."
                : "You've sent an invite. It expires 7 days after you created it. The link was shown only when you made it — if you've lost it, cancel and start fresh."}
            </p>

            {inviteUrl ? (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  readOnly
                  aria-label="Invite link"
                  value={inviteUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 font-mono text-[12px] text-muted-foreground outline-none focus-visible:border-accent"
                />
                <button
                  type="button"
                  onClick={copyLink}
                  className="shrink-0 rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-accent-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.97]"
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
              </div>
            ) : null}

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => revoke(link.linkId)}
                disabled={busyLink}
                className="rounded-lg border px-3 py-2 text-[12.5px] text-muted-foreground outline-none transition-colors duration-150 hover:border-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97] disabled:opacity-50"
              >
                {busyLink ? "Cancelling…" : "Cancel invitation"}
              </button>
              {linkError ? (
                <span role="alert" className="font-serif text-[12.5px] italic text-accent">
                  {linkError}
                </span>
              ) : null}
            </div>
          </Card>
        ) : (
          <Card>
            <p className="text-pretty text-[0.95rem] leading-relaxed text-muted-foreground">
              You haven&apos;t invited anyone yet. When you&apos;re ready, invite one
              person you trust — a therapist, a counselor — to gently review the
              conversations you choose to share.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={generateInvite}
                disabled={inviting}
                className="rounded-xl bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-foreground shadow-sm outline-none transition-[background-color,transform] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.97] disabled:opacity-50"
              >
                {inviting ? "Creating…" : "Invite a trusted person"}
              </button>
              {inviteError ? (
                <span role="alert" className="font-serif text-[12.5px] italic text-accent">
                  {inviteError}
                </span>
              ) : null}
            </div>
          </Card>
        )}
      </Zone>

      {/* Zone 2 — the boundary: exactly which conversations are shared. */}
      {link.kind === "active" ? (
        <Zone label="Conversations you're sharing" delay={90}>
          {/* A separate, quieter opt-in: the mood trend rides its own switch,
              off until chosen, and carries only scores and dates. */}
          <div className="flex items-center justify-between gap-4 rounded-xl border bg-card/60 px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-[0.9rem] font-medium text-foreground">Share my mood trend</p>
              <p className="mt-0.5 text-pretty text-[12px] leading-relaxed text-muted-foreground">
                Scores and dates only — never your notes.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={moodOn}
              aria-label="Share my mood trend"
              onClick={toggleMoodSharing}
              disabled={moodBusy}
              className={`relative h-6 w-11 shrink-0 rounded-full outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 ${
                moodOn ? "bg-accent" : "bg-muted"
              }`}
            >
              {/* Positioned via `left`, never `translate`: the global
                  reduced-motion guard strips hover/active translate to hold
                  elements still, and a knob whose position rode on translate
                  would snap to the wrong side on hover — misreporting the
                  sharing state. With `left`, reduced motion only makes the
                  move instant; the position stays truthful. */}
              <span
                aria-hidden
                className={`absolute top-1 size-4 rounded-full shadow-sm transition-[left,background-color] duration-200 motion-reduce:transition-none ${
                  moodOn ? "left-[22px] bg-accent-foreground" : "left-1 bg-muted-foreground"
                }`}
              />
            </button>
          </div>
          {moodError ? (
            <p role="alert" className="font-serif text-[12.5px] italic text-accent">
              {moodError}
            </p>
          ) : null}

          {shared.length === 0 ? (
            <p className="text-pretty font-serif text-[0.95rem] italic leading-relaxed text-muted-foreground">
              You&apos;re not sharing any conversations yet. Open any conversation
              and choose “Share with {link.therapistName}” when you&apos;re ready.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {shared.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-3 rounded-xl border bg-card/60 px-4 py-3"
                >
                  <Link
                    href={`/chat/${c.id}`}
                    className="min-w-0 flex-1 truncate text-[0.9rem] font-medium text-foreground outline-none transition-colors hover:text-accent focus-visible:text-accent"
                  >
                    {c.title}
                  </Link>
                  <button
                    type="button"
                    aria-label={`Stop sharing ${c.title}`}
                    onClick={() => stopSharing(c.id)}
                    disabled={unsharing === c.id}
                    className="shrink-0 rounded-lg px-3 py-1.5 text-[12.5px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97] disabled:opacity-50"
                  >
                    {unsharing === c.id ? "Stopping…" : "Stop sharing"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {shareError ? (
            <p role="alert" className="font-serif text-[12.5px] italic text-accent">
              {shareError}
            </p>
          ) : null}
        </Zone>
      ) : null}

      {/* Zone 3 — the record: what your trusted person actually did. */}
      <Zone label="What's happened" delay={140}>
        {audit.length === 0 ? (
          <p className="text-pretty font-serif text-[0.95rem] italic leading-relaxed text-muted-foreground">
            Nothing yet. When you invite someone and start sharing, every step
            they take shows up here.
          </p>
        ) : (
          <ul className="flex flex-col">
            {audit.map((e) => (
              <li key={e.id} className="flex items-start gap-3 py-2.5">
                <span
                  aria-hidden
                  className={`mt-[7px] size-1.5 shrink-0 rounded-full ${
                    isClientAction(e.actor) ? "bg-muted-foreground/50" : "bg-accent"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] leading-snug text-foreground">
                    {describeAuditAction(e.action, e.therapistName, e.actor)}
                    {e.title ? (
                      <span className="ml-1.5 text-muted-foreground">— {e.title}</span>
                    ) : null}
                  </p>
                </div>
                <time
                  suppressHydrationWarning
                  className="shrink-0 pt-px text-[11.5px] tabular-nums text-muted-foreground/80"
                >
                  {relativeTime(e.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Zone>

      {/* Zone 4 — notes left directly for you (client-scoped, survive revocation). */}
      {notes.length > 0 ? (
        <Zone label="Notes left for you" delay={190}>
          <ul className="flex flex-col gap-3">
            {notes.map((n) => (
              <li key={n.id}>
                <PublicNoteCard therapistName={n.therapistName} body={n.body} createdAt={n.createdAt} />
              </li>
            ))}
          </ul>
        </Zone>
      ) : null}
    </main>
  );
}
