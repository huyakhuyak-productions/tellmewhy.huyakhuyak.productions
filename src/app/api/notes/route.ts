import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isUniformNotFound, ValidationError } from "@/lib/errors";
import { createNote, listNotes, MAX_NOTE_BODY_LENGTH } from "@/lib/notes";
import { noteRateLimiter } from "@/lib/rate-limit";
import { withRequestScope } from "@/lib/request-scope";

// Exactly one source per note: a hand-written body, or a message to keep.
// A boolean XOR refinement (rather than a union of `z.undefined()` members)
// so a missing key and a present-but-undefined key are treated alike.
const noteSchema = z
  .object({
    body: z.string().min(1).max(MAX_NOTE_BODY_LENGTH).optional(),
    messageId: z.uuid().optional(),
  })
  .refine((data) => (data.body === undefined) !== (data.messageId === undefined));

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!noteRateLimiter.consume(session.user.id)) {
    return Response.json({ error: "A gentle pace — try again in a moment" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = noteSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });

  try {
    const { body: noteBody, messageId } = parsed.data;
    const created = await withRequestScope(() =>
      // The refinement guarantees exactly one is defined: if there's no
      // messageId, noteBody is present.
      createNote(session.user.id, messageId !== undefined ? { messageId } : { body: noteBody as string }),
    );
    return Response.json({ id: created.id }, { status: 201 });
  } catch (error) {
    // A foreign or missing message is indistinguishable from nonexistence.
    if (isUniformNotFound(error)) return Response.json({ error: "Not found" }, { status: 404 });
    if (error instanceof ValidationError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export async function GET(): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  // Decrypts the owner's notes — scope the request so the DEK unwrap memoizes.
  return withRequestScope(async () => {
    try {
      const notes = await listNotes(userId);
      return Response.json({ notes });
    } catch (error) {
      // A stale session of a just-deleted user (own key tombstoned) gets the
      // uniform 404, never a 500.
      if (isUniformNotFound(error)) return Response.json({ error: "Not found" }, { status: 404 });
      throw error;
    }
  });
}
