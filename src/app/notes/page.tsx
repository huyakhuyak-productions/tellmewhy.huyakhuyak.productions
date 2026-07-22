export { noIndexMetadata as metadata } from "@/lib/noindex-metadata";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isUniformNotFound } from "@/lib/errors";
import { listNotes } from "@/lib/notes";
import { withRequestScope } from "@/lib/request-scope";
import { NotesScreen } from "@/components/notes/notes-screen";

export default async function NotesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?next=/notes");
  // A stale session of a just-deleted user (own key tombstoned) 404s here
  // instead of 500ing — same notFound() path a missing resource takes.
  const notes = await withRequestScope(() => listNotes(session.user.id)).catch((error) => {
    if (isUniformNotFound(error)) notFound();
    throw error;
  });
  return <NotesScreen notes={notes} />;
}
