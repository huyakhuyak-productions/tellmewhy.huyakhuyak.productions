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
  // Same transactional shape as conversations.ts's saveMessage: the insert
  // and the updatedAt bump must succeed or fail together, or the sidebar's
  // "most recent" ordering could silently drift from reality.
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(messages)
      .values({ conversationId, sender: "therapist", authorId: therapistId, ciphertext: encryptText(dek, text) })
      .returning({ id: messages.id });
    await tx.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
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
