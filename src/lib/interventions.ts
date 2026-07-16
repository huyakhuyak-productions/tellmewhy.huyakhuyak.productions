// Interventions: a therapist stepping into a shared conversation as a
// labeled human. The message body still belongs to the conversation — the
// client's — so it encrypts with the CLIENT's DEK, exactly like every other
// message in that conversation. No model call happens here; interventions
// are silent appends, never AI turns.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { recordAudit } from "./audit";
import { encryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { NotFoundError } from "./errors";
import { requireGrantedConversation } from "./sharing";

// PRIVATE to this module. This is the one place client-ownership is
// bypassed — by design, exactly once — because the caller has already
// passed the sharing gate (an active link + a live grant), which stands in
// for ownership here. This function must never be exported, and
// conversations.ts must never grow a public equivalent: any other module
// needing to append a message on a client's behalf should be gated the same
// way, not handed this bypass directly.
async function appendTherapistMessage(
  conversationId: string,
  clientId: string,
  therapistId: string,
  text: string,
): Promise<{ id: string }> {
  const dek = await getOrCreateUserDek(clientId);
  // Same transactional shape as conversations.ts's saveMessage, and the same
  // tree participation: an intervention is a silent append, so it chains onto
  // the conversation's current leaf and becomes the new leaf itself. Skipping
  // that would strand the therapist's message off the active path, hiding it
  // from the client's own view and from the AI's context.
  return db.transaction(async (tx) => {
    // Row-lock the conversation (SELECT … FOR UPDATE) so this append serializes
    // against any concurrent append — client or therapist — and chains off the
    // committed leaf instead of racing to a stale one and stranding siblings.
    const [conv] = await tx
      .select({ activeLeafId: conversations.activeLeafId })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for("update");
    if (!conv) throw new NotFoundError("Conversation not found");
    const [row] = await tx
      .insert(messages)
      .values({
        conversationId,
        parentId: conv.activeLeafId,
        sender: "therapist",
        authorId: therapistId,
        ciphertext: encryptText(dek, text),
      })
      .returning({ id: messages.id });
    await tx
      .update(conversations)
      .set({ activeLeafId: row.id, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
    return row;
  });
}

// Gate → append as "therapist", encrypted with the CLIENT's DEK → audit
// intervention_sent. Ungranted, revoked, or foreign conversationId all fail
// through the gate the same way: NotFoundError, before anything is written.
export async function sendIntervention(
  therapistId: string,
  conversationId: string,
  text: string,
): Promise<{ id: string }> {
  const { clientId } = await requireGrantedConversation(therapistId, conversationId);
  const message = await appendTherapistMessage(conversationId, clientId, therapistId, text);
  await recordAudit({ clientId, therapistId, conversationId, action: "intervention_sent", actorId: therapistId });
  return message;
}
