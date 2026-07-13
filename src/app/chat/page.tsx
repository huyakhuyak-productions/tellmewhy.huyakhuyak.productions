import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listConversations } from "@/lib/conversations";
import { listExercisesForClient } from "@/lib/exercises";
import { listFolders } from "@/lib/folders";
import { listGrantsForClient } from "@/lib/sharing";
import { listMoodCheckins } from "@/lib/mood";
import { moodTodayUTC } from "@/lib/mood-sparkline";
import { getActiveLinkForClient } from "@/lib/therapist-links";
import { HeroComposer } from "@/components/home/hero-composer";
import { MoodCheckin } from "@/components/chat/mood-checkin";
import { AssignmentCards } from "@/components/home/assignment-cards";
import { FolderChips } from "@/components/home/folder-chips";

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const [conversations, folders, grantIds, activeLink, recentMood, exercises] = await Promise.all([
    listConversations(session.user.id),
    listFolders(session.user.id),
    listGrantsForClient(session.user.id),
    getActiveLinkForClient(session.user.id),
    // Just enough to know today's check-in (if any) so the row opens pre-set.
    listMoodCheckins(session.user.id, 1),
    listExercisesForClient(session.user.id),
  ]);

  const today = moodTodayUTC();
  const todayCheckin = recentMood.find((c) => c.day === today) ?? null;

  // Actionable homework waiting on the person: status active AND its link still
  // live. Therapist steering dies with the relationship, so a revoked-link
  // assignment drops off the home band (it stays on /exercises as their data).
  const assignments = exercises
    .filter((e) => e.status === "active" && e.linkActive)
    .map((e) => ({ id: e.id, instruction: e.instruction, therapistName: e.therapistName }));

  const folderNames = new Map(folders.map((f) => [f.id, f.name]));
  // The full history, not just a slice — mobile has no rail, so these chips
  // are the only way to reach conversation #7 and beyond.
  const allConversations = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    folderId: c.folderId,
    folderName: c.folderId ? (folderNames.get(c.folderId) ?? null) : null,
    updatedAt: c.updatedAt,
  }));

  return (
    <main className="relative flex min-h-dvh w-full flex-col items-center gap-12 px-5 pb-16 pt-20 md:gap-16 md:pt-28">
      <div aria-hidden className="ambient-room" />

      <HeroComposer />

      <MoodCheckin
        initialScore={todayCheckin?.score ?? null}
        initialNote={todayCheckin?.note ?? null}
      />

      {assignments.length > 0 ? <AssignmentCards assignments={assignments} /> : null}

      {allConversations.length === 0 ? (
        <p className="text-pretty font-serif text-lg italic text-muted-foreground">
          This space is yours. Start whenever you&apos;re ready.
        </p>
      ) : (
        <FolderChips
          folders={folders.map((f) => ({ id: f.id, name: f.name }))}
          conversations={allConversations}
          sharedIds={grantIds}
          hasActiveLink={activeLink !== null}
        />
      )}

      {/* Always reachable, assignment or not — the standalone thought record. */}
      <Link
        href="/exercises"
        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground/80 outline-none transition-colors duration-150 hover:text-accent focus-visible:text-accent"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M3 12.5V4a1 1 0 0 1 1-1h6.5M10.5 3l2.5 2.5M13 5.5V12a1 1 0 0 1-1 1H5.5M4 12l7.5-7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Thought records
      </Link>

      {/* Reachable on every viewport — the rail's notes panel is desktop-only. */}
      <Link
        href="/notes"
        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground/80 outline-none transition-colors duration-150 hover:text-accent focus-visible:text-accent"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M4 2.5h8v11l-4-3-4 3v-11Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Notes to your future self
      </Link>

      {/* A calm, single way through to sharing — home itself stays quiet. */}
      <Link
        href="/trust"
        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground/80 outline-none transition-colors duration-150 hover:text-accent focus-visible:text-accent"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 1.8 3 4v3.5c0 3 2.1 5.2 5 6.7 2.9-1.5 5-3.7 5-6.7V4L8 1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {activeLink ? "Trust & sharing" : "Invite a trusted person"}
      </Link>

      {/* Roles aren't exclusive — a therapist may also write here. A quiet way
          across to the desk, shown only when this session actually is one. */}
      {session.user.role === "therapist" ? (
        <Link
          href="/therapist"
          className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground/80 outline-none transition-colors duration-150 hover:text-accent focus-visible:text-accent"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M2.5 13V4.5A1.5 1.5 0 0 1 4 3h8a1.5 1.5 0 0 1 1.5 1.5V13M2 13h12M6.5 6.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Your practice
        </Link>
      ) : null}
    </main>
  );
}
