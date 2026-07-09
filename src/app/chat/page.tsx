import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listConversations } from "@/lib/conversations";
import { listFolders } from "@/lib/folders";
import { listGrantsForClient } from "@/lib/sharing";
import { getActiveLinkForClient } from "@/lib/therapist-links";
import { HeroComposer } from "@/components/home/hero-composer";
import { FolderChips } from "@/components/home/folder-chips";

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const [conversations, folders, grantIds, activeLink] = await Promise.all([
    listConversations(session.user.id),
    listFolders(session.user.id),
    listGrantsForClient(session.user.id),
    getActiveLinkForClient(session.user.id),
  ]);

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
