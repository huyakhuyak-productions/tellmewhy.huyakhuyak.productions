import { describe, expect, it } from "vitest";
import {
  type TreeNode,
  deepestDescendant,
  projectMarkerOntoPath,
  resolveActivePath,
  siblingsOf,
  versionInfo,
} from "./message-tree";

// A tiny date helper so the fixtures read as an ordering, not wall-clock times.
const at = (seconds: number) => new Date(2026, 0, 1, 0, 0, seconds);
const node = (id: string, parentId: string | null, seconds: number): TreeNode => ({
  id,
  parentId,
  createdAt: at(seconds),
});

describe("resolveActivePath", () => {
  it("returns [] for empty input", () => {
    expect(resolveActivePath([], null)).toEqual([]);
    expect(resolveActivePath([], "anything")).toEqual([]);
  });

  it("walks a linear chain root-first", () => {
    const nodes = [node("a", null, 1), node("b", "a", 2), node("c", "b", 3)];
    expect(resolveActivePath(nodes, "c")).toEqual(["a", "b", "c"]);
  });

  it("resolves through the active leaf's own side of a branch", () => {
    // a -> b, and b has two children c and d; the active leaf is on d's side.
    const nodes = [
      node("a", null, 1),
      node("b", "a", 2),
      node("c", "b", 3),
      node("d", "b", 4),
      node("e", "d", 5),
    ];
    expect(resolveActivePath(nodes, "e")).toEqual(["a", "b", "d", "e"]);
    expect(resolveActivePath(nodes, "c")).toEqual(["a", "b", "c"]);
  });

  it("falls back to the latest root's deepest chain when the leaf is null", () => {
    // Two roots; the later one (r2) wins, then follow its deepest-latest chain.
    const nodes = [
      node("r1", null, 1),
      node("r1a", "r1", 2),
      node("r2", null, 3),
      node("r2a", "r2", 4),
      node("r2b", "r2a", 5),
    ];
    expect(resolveActivePath(nodes, null)).toEqual(["r2", "r2a", "r2b"]);
  });

  it("falls back the same way for an unknown leaf id", () => {
    const nodes = [node("a", null, 1), node("b", "a", 2)];
    expect(resolveActivePath(nodes, "ghost")).toEqual(["a", "b"]);
  });
});

describe("siblingsOf", () => {
  it("orders siblings by createdAt then id, including the node itself", () => {
    const nodes = [
      node("p", null, 1),
      node("y", "p", 3),
      node("x", "p", 2),
      node("z", "p", 3), // same createdAt as y → id tiebreak (y < z)
    ];
    expect(siblingsOf(nodes, "x")).toEqual(["x", "y", "z"]);
  });

  it("treats all parentId-null roots as one sibling group", () => {
    const nodes = [node("b", null, 2), node("a", null, 1), node("child", "a", 3)];
    expect(siblingsOf(nodes, "a")).toEqual(["a", "b"]);
  });

  it("returns [] for an unknown id", () => {
    expect(siblingsOf([node("a", null, 1)], "ghost")).toEqual([]);
  });
});

describe("deepestDescendant", () => {
  it("returns the node itself when it is a leaf", () => {
    expect(deepestDescendant([node("a", null, 1)], "a")).toBe("a");
  });

  it("follows the latest child at each level even when an older branch is deeper", () => {
    // A's older child B has a deep subtree (B->D->E); A's newer child C is
    // shallow (C->F). The newer child must win at A's level, then continue.
    const nodes = [
      node("a", null, 1),
      node("b", "a", 2), // older child, deeper subtree
      node("c", "a", 3), // newer child, shallow subtree
      node("d", "b", 4),
      node("e", "d", 5),
      node("f", "c", 6),
    ];
    expect(deepestDescendant(nodes, "a")).toBe("f");
    // And from B directly it does dive into the deep side.
    expect(deepestDescendant(nodes, "b")).toBe("e");
  });

  it("breaks a createdAt tie by id when picking the latest child", () => {
    const nodes = [node("a", null, 1), node("x", "a", 2), node("y", "a", 2)];
    // Same time → larger id wins as the "latest".
    expect(deepestDescendant(nodes, "a")).toBe("y");
  });
});

describe("versionInfo", () => {
  it("reports index/count/siblings only for branched path nodes", () => {
    // a -> b, b has children c and d; active path goes a,b,d.
    const nodes = [
      node("a", null, 1),
      node("b", "a", 2),
      node("c", "b", 3),
      node("d", "b", 4),
    ];
    const info = versionInfo(nodes, ["a", "b", "d"]);
    // a and b are unbranched (single sibling) → absent.
    expect(info.has("a")).toBe(false);
    expect(info.has("b")).toBe(false);
    const d = info.get("d");
    expect(d).toEqual({ index: 1, count: 2, siblings: ["c", "d"] });
  });

  it("counts multiple roots as a branched version set", () => {
    const nodes = [node("r1", null, 1), node("r2", null, 2)];
    const info = versionInfo(nodes, ["r2"]);
    expect(info.get("r2")).toEqual({ index: 1, count: 2, siblings: ["r1", "r2"] });
  });
});

describe("projectMarkerOntoPath", () => {
  const nodes = [
    node("a", null, 1),
    node("b", "a", 2),
    node("c", "b", 3),
    node("off", "a", 2), // off-path node created at the same time as b
  ];
  const path = ["a", "b", "c"];

  it("returns the marker itself when it is on the path", () => {
    expect(projectMarkerOntoPath(nodes, path, "b")).toBe("b");
  });

  it("projects an off-path marker to the last earlier-or-equal path node", () => {
    // off was created at t=2, same as b; last path node with createdAt <= t=2 is b.
    expect(projectMarkerOntoPath(nodes, path, "off")).toBe("b");
  });

  it("returns null for a null marker", () => {
    expect(projectMarkerOntoPath(nodes, path, null)).toBeNull();
  });

  it("returns null when the marker is older than everything on the path", () => {
    const older = [...nodes, node("old", null, 0)];
    expect(projectMarkerOntoPath(older, path, "old")).toBeNull();
  });

  it("returns null for an unknown marker id", () => {
    expect(projectMarkerOntoPath(nodes, path, "ghost")).toBeNull();
  });

  it("breaks a shared-timestamp tie by id: the marker only reaches path nodes at-or-before it in (createdAt, id) order", () => {
    // Three nodes share t=2; their ids order them m-1 < m-2(off) < m-3. The
    // off-path marker (m-2) sits BETWEEN the two path nodes, so only m-1 is
    // at-or-before it in the total order — m-3 comes after despite equal time.
    const tie = [
      node("a", null, 1),
      node("m-1", "a", 2),
      node("m-3", "m-1", 2),
      node("m-2", "a", 2), // off-path marker: same time, id between m-1 and m-3
    ];
    expect(projectMarkerOntoPath(tie, ["a", "m-1", "m-3"], "m-2")).toBe("m-1");
  });
});
