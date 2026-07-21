// Pure tree math over a conversation's messages. No DB, no React: this module
// is imported by both server libs (conversations.ts) and client components
// (the <n/m> version switcher), so it must stay free of any runtime coupling.
//
// The message graph is a forest: every message points at its parent (null =
// a root), and sibling groups — messages sharing a parent — are the version
// sets the switcher navigates. The "active path" is the single root-to-leaf
// chain the client currently sees.

export type TreeNode = { id: string; parentId: string | null; createdAt: Date };

// The one ordering used everywhere: chronological, with id as a stable
// tiebreaker so equal timestamps never make the path (or a sibling set)
// non-deterministic.
const compare = (a: TreeNode, b: TreeNode) =>
  a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1);

type Index = {
  byId: Map<string, TreeNode>;
  // parent id (null keys the root group of null-parent nodes) → sorted children.
  children: Map<string | null, TreeNode[]>;
};

// Built once per public call. Children lists are pre-sorted by `compare` so
// "latest child" is just the last element and sibling order is free.
function buildIndex(nodes: TreeNode[]): Index {
  const byId = new Map<string, TreeNode>();
  const children = new Map<string | null, TreeNode[]>();
  for (const n of nodes) {
    byId.set(n.id, n);
    const bucket = children.get(n.parentId);
    if (bucket) bucket.push(n);
    else children.set(n.parentId, [n]);
  }
  for (const bucket of children.values()) bucket.sort(compare);
  return { byId, children };
}

function deepestFrom(index: Index, id: string): string {
  let current = id;
  for (;;) {
    const kids = index.children.get(current);
    if (!kids || kids.length === 0) return current;
    // Pre-sorted ascending → the last child is the latest.
    current = kids[kids.length - 1]!.id;
  }
}

// The chain of ids from a leaf up to its root, returned root-first.
function ancestorChain(index: Index, leafId: string): string[] {
  const chain: string[] = [];
  let cursor: string | undefined = leafId;
  while (cursor !== undefined) {
    const n: TreeNode | undefined = index.byId.get(cursor);
    if (!n) break;
    chain.push(n.id);
    cursor = n.parentId ?? undefined;
  }
  return chain.reverse();
}

// The active path: the leaf's ancestor chain, root-first. A null or unknown
// leaf (legacy rows predate active_leaf_id) falls back to the latest root's
// deepest-latest chain — which for linear data is simply chronological order.
export function resolveActivePath(nodes: TreeNode[], activeLeafId: string | null): string[] {
  if (nodes.length === 0) return [];
  const index = buildIndex(nodes);

  if (activeLeafId !== null && index.byId.has(activeLeafId)) {
    return ancestorChain(index, activeLeafId);
  }

  const roots = index.children.get(null);
  if (!roots || roots.length === 0) return [];
  const latestRoot = roots[roots.length - 1]!;
  return ancestorChain(index, deepestFrom(index, latestRoot.id));
}

// Every node sharing the given node's parent (nulls grouped as one root set),
// the node itself included, ordered by `compare`. Unknown id → [].
export function siblingsOf(nodes: TreeNode[], id: string): string[] {
  const index = buildIndex(nodes);
  const self = index.byId.get(id);
  if (!self) return [];
  return (index.children.get(self.parentId) ?? []).map((n) => n.id);
}

// Follow the latest child (max by `compare`) at each level down to a leaf.
// A newer but shallower child wins at its own level over an older deep one.
export function deepestDescendant(nodes: TreeNode[], id: string): string {
  return deepestFrom(buildIndex(nodes), id);
}

// For each path node that belongs to a real version set (more than one
// sibling), its 0-based position among siblings, the set size, and the
// ordered sibling ids. Unbranched nodes are omitted entirely.
export function versionInfo(
  nodes: TreeNode[],
  pathIds: string[],
): Map<string, { index: number; count: number; siblings: string[] }> {
  const index = buildIndex(nodes);
  const out = new Map<string, { index: number; count: number; siblings: string[] }>();
  for (const id of pathIds) {
    const self = index.byId.get(id);
    if (!self) continue;
    const siblings = (index.children.get(self.parentId) ?? []).map((n) => n.id);
    if (siblings.length <= 1) continue;
    out.set(id, { index: siblings.indexOf(id), count: siblings.length, siblings });
  }
  return out;
}

// Map a marker id (e.g. a therapist's last-reviewed message) onto the active
// path: itself if on-path, otherwise the deepest path node created at or
// before the marker. A null/unknown marker, or one older than the whole path,
// projects to null.
export function projectMarkerOntoPath(
  nodes: TreeNode[],
  pathIds: string[],
  markerId: string | null,
): string | null {
  if (markerId === null) return null;
  if (pathIds.includes(markerId)) return markerId;

  const index = buildIndex(nodes);
  const marker = index.byId.get(markerId);
  if (!marker) return null;

  let projected: string | null = null;
  // pathIds are root-first, so the total order is non-decreasing down the
  // chain; the last one at or before the marker in the (createdAt, id) total
  // order is the deepest qualifying node. The id tiebreak matters when a path
  // node shares the marker's timestamp: equal clocks alone can't decide which
  // side of the marker it falls on, but the stable id can.
  for (const id of pathIds) {
    const n = index.byId.get(id);
    if (n && compare(n, marker) <= 0) projected = id;
  }
  return projected;
}
