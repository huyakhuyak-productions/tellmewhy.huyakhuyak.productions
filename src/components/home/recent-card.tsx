import Link from "next/link";
import { relativeTime } from "@/lib/relative-time";
import { CardMenu, type CardFolder } from "./card-menu";

export type RecentItem = {
  id: string;
  title: string;
  /** null when the conversation is unsorted. */
  folderId: string | null;
  /** Resolved folder name, or null when unsorted. */
  folderName: string | null;
  updatedAt: Date;
};

export function RecentCard({ item, folders }: { item: RecentItem; folders: CardFolder[] }) {
  return (
    <div className="group relative h-full">
      <Link
        href={`/chat/${item.id}`}
        className="flex h-full min-h-[112px] flex-col gap-2 rounded-[18px] border bg-card p-[18px] shadow-sm outline-none transition-[transform,border-color,box-shadow] duration-150 hover:-translate-y-px hover:border-accent/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.99]"
      >
        {item.folderName ? (
          <div className="flex items-center">
            <span className="mr-8 whitespace-nowrap rounded-full border border-border/80 px-2 py-px text-[10px] text-muted-foreground">
              {item.folderName}
            </span>
          </div>
        ) : null}
        <span className="line-clamp-2 text-pretty pr-8 text-[0.9rem] font-semibold tracking-[-0.005em]">
          {item.title}
        </span>
        <time
          suppressHydrationWarning
          className="mt-auto text-[11px] tabular-nums text-muted-foreground"
        >
          {relativeTime(item.updatedAt)}
        </time>
      </Link>

      <CardMenu
        conversationId={item.id}
        title={item.title}
        currentFolderId={item.folderId}
        folders={folders}
      />
    </div>
  );
}
