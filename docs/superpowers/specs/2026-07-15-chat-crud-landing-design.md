# tellmewhy — Chat CRUD (branching) + Public Landing (Phase 5) Design

**Date:** 2026-07-15
**Status:** Approved
**Parent spec:** `2026-07-05-tellmewhy-platform-design.md`

## What this is

Phase 5 gives the chat the full interaction surface a person expects from a
modern AI chat (edit, regenerate, versions, stop, copy, delete) — rebuilt on
this product's laws (encryption, therapist review, honesty) — and gives the
product a public face: a real landing page with a designed favicon and
serious SEO/AEO.

## Product decisions (user-approved)

1. **Full ChatGPT-parity interaction set in one phase:** delete (hide)
   conversation, edit-your-message, regenerate replies, version navigation,
   stop generation, copy message.
2. **Edits branch, ChatGPT-style.** Editing never destroys — it creates a
   sibling version; `< n/m >` navigation flips between branches.
3. **Deletion is hide-only, uniformly.** "Delete" = hide from the client's
   own view, for every conversation (shared or not). Nothing is destroyed;
   account deletion (crypto-shredding) remains the one true delete.
4. **The therapist has full version access.** The reading view carries the
   same branch switcher the client has — the clinical record is the whole
   tree, not a curated path.
5. **Hidden is restorable.** A collapsed "Hidden" section lists hidden
   conversations; restore any time; copy at hide-time is honest that shared
   conversations stay visible to the therapist.
6. **The public surface is a real landing page** at `/` for signed-out
   visitors, plus favicon set, OG images, robots/sitemap, JSON-LD, and
   llms.txt.

## Feature 1 — The message tree

### Data model

- `messages.parent_id` — nullable uuid, self-FK to `messages.id`
  (`on delete cascade` is irrelevant — messages are never row-deleted; use
  no action). Null = the conversation's root message.
- `conversations.active_leaf_id` — nullable uuid pointing at the message
  whose ancestor chain is the client's current path. Null only for empty
  conversations.
- **Backfill migration (data):** for every existing conversation, wire
  `parent_id` to the previous message in `created_at, id` order and set
  `active_leaf_id` to the last message. Generated schema migration +
  custom data-backfill migration; both must be replay-safe on an empty DB.

### Path semantics (the one shared definition)

- **Active path** = walk up from `active_leaf_id` to the root, reversed.
  All consumers of "the conversation" read the active path unless
  explicitly branch-aware: AI context window (last 30 of the active path),
  digest transcripts, mood/homework prompt assembly (unchanged), exports.
- **Siblings** of a message = same `parent_id` (same conversation), ordered
  by `created_at, id`. The version switcher shows `< index/count >` where
  count = sibling count, for any message with count > 1.
- **Switching to a sibling** moves the active leaf to that sibling's
  deepest descendant, following the latest child (`created_at, id` max) at
  each step. Switching is a client action; the therapist's reading view
  navigates branches WITHOUT touching the client's active leaf (view-local
  path state).

### Operations

- **Edit your message** (client messages only): opens the message in an
  inline composer; saving creates a NEW message row (fresh ciphertext,
  same `parent_id`), the AI streams an answer as its child, active leaf
  moves to the new reply. The old version and everything under it remain
  reachable via the switcher. Crisis classification runs on the edited
  message like any other.
- **Regenerate** (AI messages): creates a new AI sibling under the same
  parent; active leaf moves to it. Available on any AI message on the
  active path (regenerating mid-path branches there, like ChatGPT).
- **Stop generation:** the composer's send control becomes a stop control
  while streaming; stopping aborts the model stream and persists exactly
  the text that streamed (an honest partial — no marker text appended, no
  fake completion). The partial is a normal message: editable-around,
  regenerable, branchable.
- **Copy message:** hover/focus action on any message (client and AI)
  copying the plaintext to the clipboard, alongside Keep/Flag.

### Therapist-layer projections

- **Reading view:** renders the client's active path by default, with the
  same `< n/m >` switcher on branched messages (view-local navigation).
  The sharing gate is unchanged — branch access rides the existing
  conversation grant; no per-branch consent (a branch is the same
  conversation).
- **Review line:** the marker still points at a message id. On a rendered
  path that does not contain the marker's message, the line projects by
  time: it renders after the last message on that path with
  `created_at <=` the marker message's `created_at`. Advancing the marker
  sets it to a message on whatever path the therapist is reading.
- **Digests:** transcript = the client's active path; staleness compares
  `covers_up_to_message_id` to the active leaf; the anchor filter's valid
  set = messages on the current active path (anchor jumps always land).
  A digest regenerates when the client switches branches (leaf changed) —
  correct, since the digest describes the conversation as the client
  currently has it.
- **Flags / crisis / attention queue:** per-message, branch-agnostic — a
  flagged or crisis message on an inactive branch still reaches the
  attention queue; opening it from the queue navigates the reading view to
  the branch that holds it.

## Feature 2 — Hide-only deletion

- `conversations.hidden_at` — nullable timestamp. Hide sets it; restore
  nulls it.
- Every client surface that lists conversations (rail, home cards, folder
  views, stats counts) excludes hidden ones. A collapsed **Hidden** section
  (rail bottom + home) lists them with restore actions.
- The hide action lives in the existing conversation menus (rail + home
  card), labeled "Hide", with an inline confirm whose copy states exactly:
  hiding removes it from your view; if it's shared, your therapist can
  still see it; you can restore it any time.
- **Therapist surfaces ignore `hidden_at` entirely** — granted conversations
  remain listed and readable. Audit ids+times persist as ever.
- Direct navigation to a hidden conversation by its owner shows it (it is
  their data) with a quiet "hidden" chip and a restore affordance.
- AI context, digests, mood — unchanged by hiding (a hidden conversation
  is dormant, not dead).

## Feature 3 — Public landing, favicon, SEO/AEO

- **`/` routing:** signed-out → the landing page (no more redirect to
  sign-in); signed-in → `/chat` as today.
- **Landing content** (same calm design language; built through the
  frontend-design skill): hero (what tellmewhy is — a private place to
  talk, with an optional trusted person); the privacy promise, stated with
  the README's honesty (encrypted at rest per person, plaintext only in
  memory during AI inference with no-logging providers, nothing shared by
  default, sharing granular and revocable, deletion = crypto-shredding);
  how the trusted-person layer works (review line, interventions, audit
  trail); a short FAQ (4–6 questions); sign-up CTA. No fabricated
  testimonials, no fake numbers — the page claims only what the product
  does.
- **Favicon:** a designed SVG mark (quiet, matches the app's tone), shipped
  via Next file conventions (`src/app/icon.svg` + generated `favicon.ico`,
  `apple-icon.png`); PNG/ico generated from the SVG with one-off dev
  tooling (no runtime/app dependencies added).
- **Metadata:** `metadataBase` (https://tellmewhy.huyakhuyak.productions),
  title template (`%s · tellmewhy`), real descriptions; Open Graph +
  Twitter card with a designed static OG image; canonical URLs.
- **Indexing:** `robots.ts` + `sitemap.ts` — landing (and sign-in/up)
  indexed; every authenticated surface `noindex` (metadata robots) and
  disallowed in robots.txt.
- **AEO:** JSON-LD on the landing (`Organization`, `WebApplication`,
  `FAQPage` mirroring the FAQ copy); `public/llms.txt` describing the
  product for answer engines with the same honest claims.

## Cross-cutting

- **No new runtime packages.** One-off asset generation may use `bunx`
  tooling at dev time only.
- **Key ownership / crypto laws unchanged:** edited versions are new
  ciphertext under the owner's DEK; branch metadata (`parent_id`,
  `active_leaf_id`, `hidden_at`) is ids+times only.
- **Uniform 404** for foreign/missing on all new routes (edit, regenerate,
  switch, hide, restore).
- **Rate limiting:** edit/regenerate ride the chat limiter (they are model
  calls); hide/restore/switch ride a client-write limiter.
- **System-prompt total order unchanged;** crisis addendum last; notes
  never in prompt.

## Testing

- **Tree units:** path resolution, sibling ordering, deepest-descendant
  switching, backfill migration against seeded linear data, empty/1-message
  edges.
- **Branch-aware seams:** AI context = active path; digest transcript,
  staleness on leaf move, anchor validity on path; review-line projection
  on paths without the marker; flags reachable across branches.
- **Hide/restore:** client lists exclude, Hidden lists, restore round-trip;
  adversarial — therapist reading/listing UNAFFECTED by hidden_at; foreign
  hide/restore 404.
- **Stop:** aborted stream persists exactly the streamed prefix; the
  partial participates in branching.
- **e2e:** edit → new branch answers → `< 1/2 >` flips both versions (client
  AND therapist reading view); regenerate creates a sibling; stop leaves a
  usable partial; hide → Hidden section → restore; copy puts text on the
  clipboard; landing renders signed-out with FAQ + JSON-LD present and
  app pages carry noindex.

## Non-goals (backlog)

Per-message hard delete · branch merging or cross-branch search · archive
as distinct from hide · scheduled purge of hidden conversations · marketing
blog/content pages · per-branch review markers · branch-aware digest
history.
