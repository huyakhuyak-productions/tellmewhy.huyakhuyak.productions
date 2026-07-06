import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listConversations } from "@/lib/conversations";
import { listFolders } from "@/lib/folders";
import { HeroComposer } from "@/components/home/hero-composer";
import { FolderChips } from "@/components/home/folder-chips";

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const [conversations, folders] = await Promise.all([
    listConversations(session.user.id),
    listFolders(session.user.id),
  ]);

  const folderNames = new Map(folders.map((f) => [f.id, f.name]));
  const recent = conversations.slice(0, 6).map((c) => ({
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

      {recent.length === 0 ? (
        <p className="text-pretty font-serif text-lg italic text-muted-foreground">
          This space is yours. Start whenever you&apos;re ready.
        </p>
      ) : (
        <FolderChips
          folders={folders.map((f) => ({ id: f.id, name: f.name }))}
          recent={recent}
        />
      )}
    </main>
  );
}
