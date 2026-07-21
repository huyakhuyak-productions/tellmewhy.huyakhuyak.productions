-- Custom SQL migration file, put your code below! --
--
-- ⚠️  NEVER run this migration by hand once the tree/branching feature is live.
-- The drizzle migrator applies it exactly once (by journal timestamp, not by
-- content hash — editing THESE COMMENTS is safe and changes nothing), and this
-- one-time guarantee is load-bearing. The `parent_id IS NULL` / `active_leaf_id
-- IS NULL` guards below are only inert on a pre-branching database, where a NULL
-- parent means "not yet backfilled". After branching ships, a NULL parent_id is
-- a LEGITIMATE root — the first message of a conversation or a branch's sibling
-- root — so re-running would re-parent every such root to whatever message
-- happens to precede it by (created_at, id), collapsing independent sibling
-- roots into one bogus linear chain and silently corrupting the forest.
--
-- Wire the existing linear history into the tree: each message's parent is
-- the previous message of its conversation; each conversation's active leaf
-- is its last message. Replay-safe: on an empty database both UPDATEs touch
-- zero rows.
WITH ordered AS (
  SELECT id,
         lag(id) OVER (PARTITION BY conversation_id ORDER BY created_at, id) AS prev_id
  FROM messages
)
UPDATE messages m SET parent_id = o.prev_id
FROM ordered o
WHERE m.id = o.id AND o.prev_id IS NOT NULL AND m.parent_id IS NULL;--> statement-breakpoint
UPDATE conversations c SET active_leaf_id = last.id
FROM (
  SELECT DISTINCT ON (conversation_id) conversation_id, id
  FROM messages
  ORDER BY conversation_id, created_at DESC, id DESC
) last
WHERE c.id = last.conversation_id AND c.active_leaf_id IS NULL;