import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listEntriesForClient, listExercisesForClient } from "@/lib/exercises";
import { getActiveLinkForClient } from "@/lib/therapist-links";
import { ExercisesScreen } from "@/components/exercises/exercises-screen";

// The client's thought-record home: their therapist's active assignments, the
// always-present "start a thought record" (the standalone law), and every entry
// they've written. All scoped to the caller as a client — assignments survive
// revocation as their own data; only the therapist's name drops to null.
//
// `?start=<exerciseId>` opens straight into an assignment's worksheet (a home
// assignment card links here). It's read as a Page searchParams prop rather than
// useSearchParams to avoid forcing a Suspense boundary — and it only ever
// carries an opaque id, never any thought-record content.
export default async function ExercisesPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?next=/exercises");
  const userId = session.user.id;

  const [{ start }, exercises, entries, activeLink] = await Promise.all([
    searchParams,
    listExercisesForClient(userId),
    listEntriesForClient(userId),
    getActiveLinkForClient(userId),
  ]);

  // Actionable homework = status active AND its link still live. Therapist
  // steering dies with the relationship, so once the link is revoked the ask
  // stops inviting new work (closed ones stop the same way).
  const assignments = exercises
    .filter((e) => e.status === "active" && e.linkActive)
    .map((e) => ({
      id: e.id,
      instruction: e.instruction,
      therapistName: e.therapistName,
      createdAt: e.createdAt,
    }));

  // Assignments whose link has since been revoked: still the client's own data
  // (spec law — they never vanish), but no longer an open ask. Shown as quiet,
  // inert history rather than an actionable card.
  const pastAssignments = exercises
    .filter((e) => e.status === "active" && !e.linkActive)
    .map((e) => ({ id: e.id, instruction: e.instruction, createdAt: e.createdAt }));

  const entryRows = entries.map((e) => ({
    id: e.id,
    exerciseId: e.exerciseId,
    payload: e.payload,
    sharedAt: e.sharedAt,
    createdAt: e.createdAt,
  }));

  return (
    <ExercisesScreen
      assignments={assignments}
      pastAssignments={pastAssignments}
      entries={entryRows}
      activeLink={activeLink ? { therapistName: activeLink.therapistName } : null}
      startExerciseId={start ?? null}
    />
  );
}
