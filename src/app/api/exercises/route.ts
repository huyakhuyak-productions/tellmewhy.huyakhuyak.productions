import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isUniformNotFound } from "@/lib/errors";
import { listEntriesForClient, listExercisesForClient } from "@/lib/exercises";
import { withRequestScope } from "@/lib/request-scope";

// One round trip for the client's homework surface: the exercises assigned to
// them and their own entries against those exercises. Both are the client's own
// data (client DEK) and survive revocation.
export async function GET(): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  // Both reads decrypt with the same user's DEK — scope the request so the DEK
  // unwrap memoizes across the two calls (see the chat route).
  return withRequestScope(async () => {
    try {
      const [exercises, entries] = await Promise.all([listExercisesForClient(userId), listEntriesForClient(userId)]);
      return Response.json({ exercises, entries });
    } catch (error) {
      // A stale session of a just-deleted user (own key tombstoned) gets the
      // uniform 404, never a 500.
      if (isUniformNotFound(error)) return Response.json({ error: "Not found" }, { status: 404 });
      throw error;
    }
  });
}
