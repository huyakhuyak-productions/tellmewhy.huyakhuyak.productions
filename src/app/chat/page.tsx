import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { listConversations } from "@/lib/conversations";
import { NewConversationButton } from "@/components/chat/new-conversation-button";

export default async function ChatListPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const conversations = await listConversations(session.user.id);

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-8">
      <div aria-hidden className="ambient-room" />
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-[1.6rem] font-medium tracking-[-0.01em]">
          Your conversations
        </h1>
        <p className="text-sm text-muted-foreground">
          Everything here stays between us.
        </p>
      </header>

      {conversations.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 py-16 text-center">
          <p className="text-pretty font-serif text-lg italic text-muted-foreground">
            This space is yours. Start whenever you&apos;re ready.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link
                href={`/chat/${c.id}`}
                className="group flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3.5 shadow-sm outline-none transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-px hover:border-accent/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.99]"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium">{c.title}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {c.updatedAt.toLocaleDateString()}
                  </span>
                </span>
                <svg
                  className="size-4 shrink-0 text-muted-foreground/60 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M6 3.5 10.5 8 6 12.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto pt-2">
        <NewConversationButton />
      </div>
    </main>
  );
}
