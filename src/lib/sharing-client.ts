// Client-side sharing toggles, shared by every surface that can grant or
// revoke a conversation (the rail row menu, the home card menu, the flag
// prompt, the Trust screen list). One place so the endpoint and the calm
// failure semantics never drift between them. Each returns whether the change
// landed; callers refresh and surface their own quiet notice on false.
export async function shareConversation(conversationId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/conversations/${conversationId}/share`, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function stopSharingConversation(conversationId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/conversations/${conversationId}/share`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}
