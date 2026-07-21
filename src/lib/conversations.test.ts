import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { eq } from "drizzle-orm";
import {
  NotFoundError,
  createConversation,
  flagMessageForTherapist,
  listConversations,
  listHiddenConversations,
  loadMessageTree,
  loadMessages,
  saveMessage,
  setActiveLeaf,
  setConversationHidden,
} from "./conversations";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { encryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { cleanupSeededUsers, seedUser } from "@/test/seed-user";

describe("encrypted conversations", () => {
  let userId: string;
  beforeEach(async () => {
    userId = await seedUser();
  });
  afterEach(cleanupSeededUsers);

  it("stores the title and message bodies as ciphertext only", async () => {
    const { id } = await createConversation(userId, "Feeling overwhelmed");
    await saveMessage({ conversationId: id, userId, sender: "client", text: "I had a rough day" });

    const [convRow] = await db.select().from(conversations).where(eq(conversations.id, id));
    const msgRows = await db.select().from(messages).where(eq(messages.conversationId, id));
    expect(convRow.titleCiphertext).not.toContain("overwhelmed");
    expect(msgRows[0].ciphertext).not.toContain("rough day");
  });

  it("round-trips messages in order with decrypted text", async () => {
    const { id } = await createConversation(userId, "Check-in");
    await saveMessage({ conversationId: id, userId, sender: "client", text: "hello" });
    await saveMessage({ conversationId: id, userId, sender: "ai", text: "hi, how are you feeling?" });

    const loaded = await loadMessages(id, userId);
    expect(loaded.map((m) => [m.sender, m.text])).toEqual([
      ["client", "hello"],
      ["ai", "hi, how are you feeling?"],
    ]);
  });

  it("lists conversations with decrypted titles, newest first", async () => {
    await createConversation(userId, "First");
    await createConversation(userId, "Second");
    const list = await listConversations(userId);
    expect(list.map((c) => c.title)).toEqual(["Second", "First"]);
  });

  it("refuses access to another user's conversation", async () => {
    const { id } = await createConversation(userId, "Private");
    await expect(loadMessages(id, "someone-else")).rejects.toThrow(NotFoundError);
    await expect(
      saveMessage({ conversationId: id, userId: "someone-else", sender: "client", text: "hi" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("persists riskLevel on messages", async () => {
    const { id } = await createConversation(userId, "Hard night");
    await saveMessage({ conversationId: id, userId, sender: "client", text: "…", riskLevel: "crisis" });
    const [m] = await loadMessages(id, userId);
    expect(m.riskLevel).toBe("crisis");
  });

  it("includes the folder assignment in the list", async () => {
    const { createFolder, assignConversationToFolder } = await import("./folders");
    const folder = await createFolder(userId, "work / career");
    const a = await createConversation(userId, "Deadline spiral");
    await createConversation(userId, "Unsorted one");
    await assignConversationToFolder(a.id, userId, folder.id);
    const list = await listConversations(userId);
    expect(list.find((c) => c.id === a.id)?.folderId).toBe(folder.id);
    expect(list.find((c) => c.title === "Unsorted one")?.folderId).toBeNull();
  });

  it("renames with re-encryption and marks the title customized", async () => {
    const { renameConversation, isTitleCustomized } = await import("./conversations");
    const { id } = await createConversation(userId, "July 6");
    await renameConversation(id, userId, "Replaying a work conversation");
    const list = await listConversations(userId);
    expect(list.find((c) => c.id === id)?.title).toBe("Replaying a work conversation");
    expect(await isTitleCustomized(id, userId)).toBe(true);
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
    expect(row.titleCiphertext).not.toContain("Replaying");
  });

  it("auto-rename (customized: false) does not claim the title for humans", async () => {
    const { renameConversation, isTitleCustomized } = await import("./conversations");
    const { id } = await createConversation(userId, "July 6");
    await renameConversation(id, userId, "A generated title", { customized: false });
    expect(await isTitleCustomized(id, userId)).toBe(false);
  });

  it("never lets an auto-rename land after a human has already claimed the title", async () => {
    const { renameConversation, isTitleCustomized } = await import("./conversations");
    const { id } = await createConversation(userId, "July 6");
    await renameConversation(id, userId, "Mine"); // human rename, customized: true
    // Simulates the auto-title write landing after a human renamed mid-window —
    // the atomic WHERE clause must refuse it outright.
    await renameConversation(id, userId, "Auto", { customized: false });

    const list = await listConversations(userId);
    expect(list.find((c) => c.id === id)?.title).toBe("Mine");
    expect(await isTitleCustomized(id, userId)).toBe(true);
  });

  it("still lets a human rename win when it comes after an auto-rename", async () => {
    const { renameConversation, isTitleCustomized } = await import("./conversations");
    const { id } = await createConversation(userId, "July 6");
    await renameConversation(id, userId, "Auto", { customized: false });
    await renameConversation(id, userId, "Mine"); // human rename, customized: true

    const list = await listConversations(userId);
    expect(list.find((c) => c.id === id)?.title).toBe("Mine");
    expect(await isTitleCustomized(id, userId)).toBe(true);
  });

  it("refuses foreign rename and metadata reads", async () => {
    const { renameConversation, isTitleCustomized } = await import("./conversations");
    const { id } = await createConversation(userId, "Private");
    await expect(renameConversation(id, "someone-else", "x")).rejects.toThrow(NotFoundError);
    await expect(isTitleCustomized(id, "someone-else")).rejects.toThrow(NotFoundError);
  });

  it("rolls back the message insert if bumping the conversation's updatedAt fails", async () => {
    const { id } = await createConversation(userId, "Transactional");

    // Force the transaction's second statement (the updatedAt bump) to throw,
    // via the real db.transaction/tx — not a hand-rolled mock of "atomicity" —
    // so a genuine Postgres rollback is what we're actually asserting on below.
    const originalTransaction = db.transaction.bind(db);
    const transactionSpy = vi.spyOn(db, "transaction").mockImplementationOnce((callback: Parameters<typeof db.transaction>[0]) =>
      originalTransaction(async (tx) => {
        vi.spyOn(tx, "update").mockImplementationOnce(() => {
          throw new Error("simulated updatedAt bump failure");
        });
        return callback(tx);
      }),
    );

    await expect(
      saveMessage({ conversationId: id, userId, sender: "client", text: "should not persist" }),
    ).rejects.toThrow("simulated updatedAt bump failure");
    transactionSpy.mockRestore();

    const msgRows = await db.select().from(messages).where(eq(messages.conversationId, id));
    expect(msgRows).toHaveLength(0);
  });

  it("skips a conversation with corrupted ciphertext instead of failing the whole list", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const healthy = await createConversation(userId, "Healthy");
    const corrupt = await createConversation(userId, "Will corrupt");
    await db
      .update(conversations)
      .set({ titleCiphertext: "not-valid-ciphertext" })
      .where(eq(conversations.id, corrupt.id));

    const list = await listConversations(userId);
    expect(list.map((c) => c.id)).toContain(healthy.id);
    expect(list.map((c) => c.id)).not.toContain(corrupt.id);
    // Only the row id may be logged — never the ciphertext or decrypted text.
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining(corrupt.id));
    const [loggedMessage] = consoleErrorSpy.mock.calls[0]!;
    expect(loggedMessage).not.toContain("not-valid-ciphertext");
    consoleErrorSpy.mockRestore();
  });

  it("skips a message with corrupted ciphertext instead of failing the whole conversation", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { id } = await createConversation(userId, "Mixed health");
    await saveMessage({ conversationId: id, userId, sender: "client", text: "good message" });
    const corrupt = await saveMessage({ conversationId: id, userId, sender: "client", text: "will corrupt" });
    await db.update(messages).set({ ciphertext: "not-valid-ciphertext" }).where(eq(messages.id, corrupt.id));

    const loaded = await loadMessages(id, userId);
    expect(loaded.map((m) => m.text)).toEqual(["good message"]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining(corrupt.id));
    const [loggedMessage] = consoleErrorSpy.mock.calls[0]!;
    expect(loggedMessage).not.toContain("not-valid-ciphertext");
    consoleErrorSpy.mockRestore();
  });

  // Sentinel for the id + errorCause(error) discipline (never the raw error
  // object): a corrupted row must log only the row id and the failure's
  // name/message string, never a dumped object (which would carry a full
  // stack trace) or any ciphertext/plaintext fragment. Mirrors the phase-3
  // sentinel pattern in digests.test.ts (util.inspect over the logged call).
  it("never logs the raw error object when a conversation fails to decrypt", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const corrupt = await createConversation(userId, "Will corrupt");
    await db
      .update(conversations)
      .set({ titleCiphertext: "not-valid-ciphertext" })
      .where(eq(conversations.id, corrupt.id));

    await listConversations(userId);

    // Isolate the call about THIS corrupted row — unrelated console.error
    // noise elsewhere in the suite must not make this assertion flaky.
    const call = consoleErrorSpy.mock.calls.find((args) =>
      args.some((arg) => typeof arg === "string" && arg.includes(corrupt.id)),
    );
    expect(call).toBeDefined();
    // Exactly one argument — a raw error object would show up as a second
    // positional argument to console.error, which this call shape rules out.
    expect(call).toHaveLength(1);

    const logged = inspect(call, { depth: 20 });
    expect(logged).toContain(corrupt.id);
    // The crypto failure's own message must survive into the log line...
    expect(logged).toContain("Unknown ciphertext format");
    // ...but never as part of a raw object dump: no stack-trace frame, and
    // never the corrupted ciphertext itself.
    expect(logged).not.toContain("\n    at ");
    expect(logged).not.toContain("not-valid-ciphertext");
    consoleErrorSpy.mockRestore();
  });

  describe("flagMessageForTherapist", () => {
    it("sets flaggedAt on the owner's own message", async () => {
      const { id } = await createConversation(userId, "Flag me");
      const msg = await saveMessage({ conversationId: id, userId, sender: "client", text: "flag this" });

      await flagMessageForTherapist(userId, msg.id);

      const [row] = await db.select().from(messages).where(eq(messages.id, msg.id));
      expect(row.flaggedAt).not.toBeNull();
    });

    it("is idempotent — flagging an already-flagged message keeps the original timestamp", async () => {
      const { id } = await createConversation(userId, "Flag twice");
      const msg = await saveMessage({ conversationId: id, userId, sender: "client", text: "flag this" });

      await flagMessageForTherapist(userId, msg.id);
      const [firstFlag] = await db.select().from(messages).where(eq(messages.id, msg.id));

      await flagMessageForTherapist(userId, msg.id);
      const [secondFlag] = await db.select().from(messages).where(eq(messages.id, msg.id));

      expect(secondFlag.flaggedAt!.getTime()).toBe(firstFlag.flaggedAt!.getTime());
    });

    it("refuses to flag a message in someone else's conversation", async () => {
      const { id } = await createConversation(userId, "Not yours");
      const msg = await saveMessage({ conversationId: id, userId, sender: "client", text: "private" });

      await expect(flagMessageForTherapist("someone-else", msg.id)).rejects.toThrow(NotFoundError);
      const [row] = await db.select().from(messages).where(eq(messages.id, msg.id));
      expect(row.flaggedAt).toBeNull();
    });

    it("refuses a nonexistent message id", async () => {
      await expect(flagMessageForTherapist(userId, randomUUID())).rejects.toThrow(NotFoundError);
    });

    it("does not require a therapist grant — the flag waits until shared", async () => {
      const { id } = await createConversation(userId, "Unshared entirely");
      const msg = await saveMessage({ conversationId: id, userId, sender: "client", text: "no link at all" });

      await expect(flagMessageForTherapist(userId, msg.id)).resolves.toBeUndefined();
    });
  });

  describe("message tree", () => {
    it("appends to the current leaf, chaining parentId and moving activeLeafId", async () => {
      const { id } = await createConversation(userId, "Chain");
      const m1 = await saveMessage({ conversationId: id, userId, sender: "client", text: "one" });
      const m2 = await saveMessage({ conversationId: id, userId, sender: "ai", text: "two" });

      const rows = await db.select().from(messages).where(eq(messages.conversationId, id));
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(m1.id)!.parentId).toBeNull();
      expect(byId.get(m2.id)!.parentId).toBe(m1.id);

      const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
      expect(conv.activeLeafId).toBe(m2.id);
    });

    it("branches at an explicit parent: two children share it, the newest is the leaf", async () => {
      const { id } = await createConversation(userId, "Branch");
      const m1 = await saveMessage({ conversationId: id, userId, sender: "client", text: "root" });
      const m2 = await saveMessage({ conversationId: id, userId, sender: "ai", text: "first reply" });
      const m3 = await saveMessage({ conversationId: id, userId, sender: "ai", text: "retry reply", parentId: m1.id });

      const rows = await db.select().from(messages).where(eq(messages.conversationId, id));
      expect(rows.find((r) => r.id === m3.id)!.parentId).toBe(m1.id);
      const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
      expect(conv.activeLeafId).toBe(m3.id);

      // The active path follows the new branch — the abandoned m2 is gone from it.
      const loaded = await loadMessages(id, userId);
      expect(loaded.map((m) => m.text)).toEqual(["root", "retry reply"]);
      expect(loaded.map((m) => m.id)).not.toContain(m2.id);
      expect(loaded[1]!.parentId).toBe(m1.id);
    });

    it("branches at the root when given an explicit null parent", async () => {
      const { id } = await createConversation(userId, "New root");
      await saveMessage({ conversationId: id, userId, sender: "client", text: "old root" });
      const fresh = await saveMessage({ conversationId: id, userId, sender: "client", text: "fresh root", parentId: null });

      const loaded = await loadMessages(id, userId);
      expect(loaded.map((m) => m.text)).toEqual(["fresh root"]);
      const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
      expect(conv.activeLeafId).toBe(fresh.id);
    });

    it("rejects a parent from another conversation with NotFoundError", async () => {
      const a = await createConversation(userId, "A");
      const b = await createConversation(userId, "B");
      const foreign = await saveMessage({ conversationId: b.id, userId, sender: "client", text: "in B" });

      await expect(
        saveMessage({ conversationId: a.id, userId, sender: "client", text: "x", parentId: foreign.id }),
      ).rejects.toThrow(NotFoundError);
    });

    it("rejects a missing parent id with NotFoundError", async () => {
      const { id } = await createConversation(userId, "Missing parent");
      await expect(
        saveMessage({ conversationId: id, userId, sender: "client", text: "x", parentId: randomUUID() }),
      ).rejects.toThrow(NotFoundError);
    });

    it("loadMessageTree returns every message flat with the active leaf id", async () => {
      const { id } = await createConversation(userId, "Whole tree");
      const m1 = await saveMessage({ conversationId: id, userId, sender: "client", text: "root" });
      const m2 = await saveMessage({ conversationId: id, userId, sender: "ai", text: "reply a" });
      const m3 = await saveMessage({ conversationId: id, userId, sender: "ai", text: "reply b", parentId: m1.id });

      const tree = await loadMessageTree(id, userId);
      expect(new Set(tree.messages.map((m) => m.id))).toEqual(new Set([m1.id, m2.id, m3.id]));
      expect(tree.activeLeafId).toBe(m3.id);
      // Flat order is (createdAt, id) asc, so the abandoned branch is still present.
      expect(tree.messages.map((m) => m.text)).toContain("reply a");
    });

    it("setActiveLeaf flips paths and lands on the deepest descendant of the target", async () => {
      const { id } = await createConversation(userId, "Switch");
      const m1 = await saveMessage({ conversationId: id, userId, sender: "client", text: "root" });
      const m2 = await saveMessage({ conversationId: id, userId, sender: "ai", text: "b" });
      const m3 = await saveMessage({ conversationId: id, userId, sender: "client", text: "c" });
      // Branch off m1 so the active path leaves m2/m3's side.
      await saveMessage({ conversationId: id, userId, sender: "ai", text: "other branch", parentId: m1.id });
      expect((await loadMessages(id, userId)).map((m) => m.text)).toEqual(["root", "other branch"]);

      // Switching to m2 must dive to its deepest descendant (m3), not stop at m2.
      await setActiveLeaf(id, userId, m2.id);
      expect((await loadMessages(id, userId)).map((m) => m.text)).toEqual(["root", "b", "c"]);
      const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
      expect(conv.activeLeafId).toBe(m3.id);
    });

    it("setActiveLeaf refuses a message from another conversation", async () => {
      const a = await createConversation(userId, "A");
      const b = await createConversation(userId, "B");
      const foreign = await saveMessage({ conversationId: b.id, userId, sender: "client", text: "in B" });
      await expect(setActiveLeaf(a.id, userId, foreign.id)).rejects.toThrow(NotFoundError);
    });

    it("loads a legacy conversation (activeLeafId null) chronologically via the fallback", async () => {
      const { id } = await createConversation(userId, "Legacy");
      await saveMessage({ conversationId: id, userId, sender: "client", text: "first" });
      await saveMessage({ conversationId: id, userId, sender: "ai", text: "second" });
      // Simulate a pre-tree conversation: the parentId chain exists but no
      // active leaf was ever recorded.
      await db.update(conversations).set({ activeLeafId: null }).where(eq(conversations.id, id));

      const loaded = await loadMessages(id, userId);
      expect(loaded.map((m) => m.text)).toEqual(["first", "second"]);
    });

    it("keeps ancestors above a corrupt mid-chain row, skipping only the corrupt node", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { id } = await createConversation(userId, "Corrupt middle");
      const root = await saveMessage({ conversationId: id, userId, sender: "client", text: "root msg" });
      const middle = await saveMessage({ conversationId: id, userId, sender: "ai", text: "middle msg" });
      const leaf = await saveMessage({ conversationId: id, userId, sender: "client", text: "leaf msg" });
      // Corrupt ONLY the middle row. Because the active path resolves over raw
      // ids (never the ciphertext), the leaf's ancestor (root) must survive even
      // though the node linking them is unreadable — only the corrupt node drops.
      await db.update(messages).set({ ciphertext: "not-valid-ciphertext" }).where(eq(messages.id, middle.id));

      const loaded = await loadMessages(id, userId);
      expect(loaded.map((m) => [m.id, m.text])).toEqual([
        [root.id, "root msg"],
        [leaf.id, "leaf msg"],
      ]);
      // The corrupt node's id is logged (never the ciphertext), same discipline
      // as every other skip.
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining(middle.id));
      const [loggedMessage] = consoleErrorSpy.mock.calls.find((c) =>
        typeof c[0] === "string" && c[0].includes(middle.id),
      )!;
      expect(loggedMessage).not.toContain("not-valid-ciphertext");
      consoleErrorSpy.mockRestore();
    });

    // Invariant pin: if backfill ever missed rows, messages exist with all-null
    // parents (inserted here directly, bypassing saveMessage, so nothing chains)
    // and activeLeafId is never set. resolveActivePath then has no leaf to walk
    // and falls back to the latest root's deepest chain — which, with no
    // children anywhere, is just that single latest root.
    it("with all-null parents and no active leaf, falls back to the latest root only", async () => {
      const { id } = await createConversation(userId, "Unbackfilled");
      const dek = await getOrCreateUserDek(userId);
      await db.insert(messages).values({
        conversationId: id,
        parentId: null,
        sender: "client",
        ciphertext: encryptText(dek, "first"),
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      await db.insert(messages).values({
        conversationId: id,
        parentId: null,
        sender: "ai",
        ciphertext: encryptText(dek, "second"),
        createdAt: new Date("2026-01-01T00:00:01Z"),
      });

      const loaded = await loadMessages(id, userId);
      expect(loaded.map((m) => m.text)).toEqual(["second"]);
    });
  });

  describe("hiding conversations", () => {
    it("hides a conversation from the list and surfaces it under listHiddenConversations", async () => {
      const { id } = await createConversation(userId, "To hide");
      expect((await listConversations(userId)).map((c) => c.id)).toContain(id);

      await setConversationHidden(id, userId, true);

      expect((await listConversations(userId)).map((c) => c.id)).not.toContain(id);
      const hidden = await listHiddenConversations(userId);
      const entry = hidden.find((c) => c.id === id);
      expect(entry?.title).toBe("To hide");
      expect(entry?.hiddenAt).toBeInstanceOf(Date);
    });

    it("restoring reverses hiding", async () => {
      const { id } = await createConversation(userId, "Toggle");
      await setConversationHidden(id, userId, true);
      await setConversationHidden(id, userId, false);

      expect((await listConversations(userId)).map((c) => c.id)).toContain(id);
      expect((await listHiddenConversations(userId)).map((c) => c.id)).not.toContain(id);
    });

    it("refuses to hide someone else's conversation", async () => {
      const { id } = await createConversation(userId, "Not yours");
      await expect(setConversationHidden(id, "someone-else", true)).rejects.toThrow(NotFoundError);
    });

    // Pins the direct-nav contract: hiding only drops a conversation from the
    // client's LIST — the owner's page load path (loadMessages / loadMessageTree)
    // must still resolve it, so a direct link to a hidden conversation opens
    // instead of 404-ing. requireOwnedConversation never filters hiddenAt.
    it("still loads a hidden conversation for its owner via the page path", async () => {
      const { id } = await createConversation(userId, "Hidden but reachable");
      await saveMessage({ conversationId: id, userId, sender: "client", text: "still here" });
      await setConversationHidden(id, userId, true);

      const loaded = await loadMessages(id, userId);
      expect(loaded.map((m) => m.text)).toEqual(["still here"]);
      const tree = await loadMessageTree(id, userId);
      expect(tree.messages.map((m) => m.text)).toContain("still here");
    });
  });
});
