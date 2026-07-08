# tellmewhy — Phase 2: The Therapist Layer

**Date:** 2026-07-07
**Status:** Draft for user review
**Parent:** docs/superpowers/specs/2026-07-05-tellmewhy-platform-design.md (phase 2 of the approved build order)

## What this is

The half of the product that makes tellmewhy what it's meant to be: a real, trusted therapist can be linked to a client, see exactly what the client chooses to share, mark how far they've read (the review line), step into conversations as a clearly-labeled human, guide the AI invisibly, and leave notes — all under an adversarial never-leak invariant and a client-visible audit trail.

## Trust model (decision)

**The platform does not verify therapist credentials in v1.** The product's founding framing is "a real person you trust" — the client vouches by inviting; the platform's job is to make the *sharing* trustworthy, not to police licensure. All copy must be honest about this ("your trusted person", not "verified therapist"). License verification is a future, jurisdiction-dependent feature.

## Linking (invites)

- **Tokenized invite links, no email infrastructure.** Either side generates a link and shares it over any channel they already trust (the token is single-use, expires in 7 days, stored hashed).
  - Client-initiated (the primary v1 flow): client generates "invite my therapist" link → recipient opens it → signs up or signs in → accepts → the link activates and the recipient's account gains the `therapist` role (server-side; roles are never client-settable).
  - Therapist-initiated: an existing therapist generates an invite for a new client the same way.
- Lifecycle: `invited → active → revoked`. Either side can revoke at any time; revocation immediately voids all sharing grants under the link and is recorded in the audit trail.
- **One therapist per client in v1** (one active link); a client can revoke and re-link. A therapist can have many clients.

## Sharing grants

- Per-conversation, opt-in, default **nothing shared**. Grant/revoke from the conversation screen and the rail/card menus ("Share with <name>" / "Stop sharing").
- Revocation is immediate and hard (row deleted; the audit trail keeps the history).
- **Adversarial invariant (the load-bearing rule):** a therapist can never read anything from an ungranted conversation — not messages, not titles, not existence, not through notes, markers, flags, crisis queues, or counts. Enforced in a single repository-layer gate (`requireGrantedConversation(therapistId, conversationId)`: active link AND live grant) that every therapist read/write path must pass through. Tested adversarially, including the indirect surfaces.
- **Encryption honesty:** sharing means the server decrypts with the *client's* DEK to render for the granted therapist — server-mediated, access-controlled, audit-logged. The privacy page gains a sentence saying exactly that. No E2EE claims, as ever.

## The review line

- `review_markers`: per (conversation, therapist) — last-reviewed message + timestamp.
- Advancing the marker is an **explicit act** ("Mark read to here") — reviewing is an affirmation, not a scroll side-effect. Viewing and reviewing are distinct events in the audit trail.
- Client sees the divider in the chat: "Reviewed by <name> up to here". No marker → no divider.

## Therapist interventions

- A therapist can write into a granted conversation. The message is `sender: "therapist"`, rendered in the client's chat visibly as human ("<name> — your therapist" treatment, distinct from both AI and client styling).
- Sending an intervention does **not** trigger an AI reply. The AI sees it on the client's next turn, mapped into model context as a **user-role message with an attribution prefix** ("[The client's therapist, <name>, wrote:] …") — never as `assistant` (the model must not believe it authored a human's words). This replaces the phase-1 placeholder mapping (therapist→assistant), which was flagged for exactly this moment.

## Notes (three kinds)

- Stored encrypted with the **author's (therapist's) DEK** — crypto-shredding a therapist account kills their notes, matching data ownership.
- `private`: therapist-only, conversation-scoped or client-scoped (nullable conversationId). The client never sees them and never sees that they exist.
- `public`: client-visible, shown on the conversation screen (conversation-scoped) or the client's home trust panel (client-scoped).
- `ai_instruction`: client-scoped, versioned (full history kept; latest version active). Hidden from the client. Injected into the AI's system prompt **only in conversations with a live grant** — the therapist steers only where they can see. This boundary is a product-ethics decision: no invisible influence in spaces the therapist has no access to.

## Flag for my therapist

- The client can flag any message (`flagged_at` exists since phase 1). Flags in granted conversations appear in the therapist's queue; flags in ungranted conversations prompt the client to share first (the flag itself never leaks).

## Crisis notifications (in-app, v1)

- Crisis-flagged client messages in **granted** conversations surface immediately at the top of the therapist's dashboard (badge + queue-jump), independent of the review line. No email/push in v1 (no infra); the dashboard is the notification surface.
- Ungranted conversations never notify — the invariant outranks urgency, and the client's crisis resources (988 frame-break) are unaffected.

## Audit trail (client-visible)

- `audit_events`: (clientId, therapistId, conversationId nullable, action, createdAt) — **no content, ids and times only** (consistent with the documented metadata posture).
- Actions: link invited/accepted/revoked, grant created/revoked, conversation viewed (deduped within 15 minutes), review-marker advanced, intervention sent, note-published (public only — private notes and AI instructions leave no client-visible trace, by design stated in the spec).
- Client UI: a "Trust" view — link status, per-conversation sharing state, and the event feed ("<name> viewed this conversation, yesterday 21:40").

## Surfaces

- **Therapist dashboard** (`/therapist`, desktop-first, same twilight system): client list → per-client view: granted conversations (crisis/flagged badges, unread-since-marker counts), reading view (messages + review-line control + intervention composer + notes panel with the three kinds).
- **Client additions:** share/stop-sharing controls, review-line divider, therapist-message styling, public notes, the Trust view, link management (invite link generation, acceptance state, revoke).
- Role routing: therapists land on `/therapist`; a therapist can also be a client (roles are not exclusive; the dashboard and personal chat are separate surfaces).

## Data model (new tables)

`therapist_links` (id, clientId, therapistId nullable until accepted, inviteTokenHash, initiatedBy, status, createdAt/acceptedAt/revokedAt) · `sharing_grants` (id, linkId, conversationId, createdAt; hard-deleted on revoke) · `review_markers` (linkId, conversationId, lastReviewedMessageId, updatedAt) · `notes` (id, linkId, conversationId nullable, kind, bodyCiphertext, version, createdAt) · `audit_events` (as above). All therapist reads flow through the single grant gate.

## Out of scope (phase 3+)

AI session digests; mood check-ins and trendlines; homework; multi-therapist; email/push notifications; license verification; billing; per-folder grants; therapist-side exports.

## Testing

The adversarial suite is the centerpiece: every therapist-facing endpoint attempted against ungranted conversations, revoked links, revoked grants, foreign clients, and the indirect surfaces (flags, crisis queue, counts, notes, markers). Unit: link lifecycle, token hashing/expiry/single-use, note encryption at the row level, instruction versioning, audit dedupe. e2e: full journey — client invites → therapist accepts → client shares → therapist reviews/intervenes/notes → client sees the line, the human message, the public note, the audit feed → revoke → therapist sees nothing.
