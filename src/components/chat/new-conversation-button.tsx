"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewConversationButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function create() {
    setPending(true);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: new Date().toLocaleDateString(undefined, {
          month: "long",
          day: "numeric",
        }),
      }),
    });
    setPending(false);
    if (!res.ok) return;
    const { id } = await res.json();
    router.push(`/chat/${id}`);
  }

  return (
    <button
      onClick={create}
      disabled={pending}
      className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3 font-medium text-accent-foreground shadow-sm outline-none transition-[transform,background-color,box-shadow] duration-150 hover:bg-accent-hover hover:shadow-md focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
    >
      {pending ? (
        "Opening…"
      ) : (
        <>
          <svg
            className="size-[1.05rem]"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
          >
            <path
              d="M8 3.25v9.5M3.25 8h9.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          New conversation
        </>
      )}
    </button>
  );
}
