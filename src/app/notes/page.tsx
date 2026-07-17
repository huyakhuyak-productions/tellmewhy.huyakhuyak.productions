export { noIndexMetadata as metadata } from "@/lib/noindex-metadata";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listNotes } from "@/lib/notes";
import { withRequestScope } from "@/lib/request-scope";
import { NotesScreen } from "@/components/notes/notes-screen";

export default async function NotesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?next=/notes");
  const notes = await withRequestScope(() => listNotes(session.user.id));
  return <NotesScreen notes={notes} />;
}
