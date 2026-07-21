import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { reviewMarkers } from "@/db/schema";
import { NotFoundError } from "@/lib/errors";
import { requireGrantedConversation } from "@/lib/sharing";
import { loadSharedMessages } from "@/lib/therapist-access";
import { requireTherapist } from "../../_lib/require-therapist";

const paramsSchema = z.object({ conversationId: z.uuid() });

type Ctx = { params: Promise<{ conversationId: string }> };

// Messages come from loadSharedMessages, which already gates internally
// (requireGrantedConversation) and audits conversation_viewed. The marker has
// no such module function (getReviewMarkerForClient is the CLIENT's view of
// the divider), so this route calls the gate directly ONCE to get the linkId,
// then reads reviewMarkers inline with it. That's a second, redundant call
// into requireGrantedConversation
// (loadSharedMessages does its own), but it's a cheap read with no side
// effect, so the duplication costs nothing and keeps the marker read
// gate-consistent without inventing a new exported module function for it.
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const authResult = await requireTherapist();
  if (!authResult.ok) return authResult.response;

  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return Response.json({ error: "Invalid input" }, { status: 400 });
  const { conversationId } = params.data;

  try {
    const { linkId } = await requireGrantedConversation(authResult.therapistId, conversationId);
    // Only the decrypted messages leave this endpoint — the raw path nodes are a
    // server-render concern (getReadingView), not part of this JSON contract.
    const { messages } = await loadSharedMessages(authResult.therapistId, conversationId);

    const [markerRow] = await db
      .select({ messageId: reviewMarkers.lastReviewedMessageId, updatedAt: reviewMarkers.updatedAt })
      .from(reviewMarkers)
      .where(and(eq(reviewMarkers.linkId, linkId), eq(reviewMarkers.conversationId, conversationId)));

    return Response.json({ messages, marker: markerRow ?? null });
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
