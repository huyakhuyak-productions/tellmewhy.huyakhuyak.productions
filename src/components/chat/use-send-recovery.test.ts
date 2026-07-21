// @vitest-environment happy-dom
// Hook pins for send-failure recovery WIRING (extracted from chat-screen.tsx).
// The pure harvest/merge/resend helpers are covered in send-recovery.test.ts;
// here we pin how the hook drives them: filling useChat's onError handler so a
// failed send lands back in the composer, and resolving the resend key.
import "../../test/component-setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { UIMessage } from "ai";
import { useSendRecovery } from "./use-send-recovery";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function user(text: string, id: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}
function assistant(text: string, id: string): UIMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

// A thread whose tail is a failed user send (with a partial reply that never
// completed would sit after it, but harvest keys off the last user message).
const thread: UIMessage[] = [
  user("first", "u1"),
  assistant("reply", "a1"),
  user("lost words", "u2"),
];

type Deps = Parameters<typeof useSendRecovery>[0];

function makeDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    messages: thread,
    setMessages: vi.fn(),
    setDraft: vi.fn(),
    setSendFailure: vi.fn(),
    rateLimited: { current: false },
    draftKey: "tellmewhy:draft:c1",
    clientMessageIdRef: { current: "key-123" },
    failedSendRef: { current: null },
    failureHandlerRef: { current: () => {} },
    ...overrides,
  };
}

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  sessionStorage.clear();
});

describe("useSendRecovery — failure handler wiring", () => {
  it("restores the failed words to the composer, drops the tail, stashes the key, clears the hero draft", () => {
    const deps = makeDeps();
    sessionStorage.setItem(deps.draftKey, "hero hand-off");

    renderHook(() => useSendRecovery(deps));
    act(() => deps.failureHandlerRef.current());

    // The failed words merge into whatever the composer already held.
    const updater = (deps.setDraft as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updater("")).toBe("lost words");

    // The failed tail is removed so a retry can't duplicate it.
    expect(deps.setMessages).toHaveBeenCalledWith([thread[0], thread[1]]);

    // The attempt's key is stashed against its words for an unedited retry.
    expect(deps.failedSendRef.current).toEqual({ id: "key-123", text: "lost words" });

    // The recovered hero draft must not auto-resend on a later remount.
    expect(sessionStorage.getItem(deps.draftKey)).toBeNull();

    // A calm generic notice is surfaced.
    expect(deps.setSendFailure).toHaveBeenCalledWith({ kind: "generic" });
  });

  it("surfaces the rate-limit notice when the last response was a 429", () => {
    const deps = makeDeps({ rateLimited: { current: true } });
    renderHook(() => useSendRecovery(deps));
    act(() => deps.failureHandlerRef.current());
    expect(deps.setSendFailure).toHaveBeenCalledWith({ kind: "rate-limit" });
  });

  it("does not stash a key when no client-text attempt was in flight", () => {
    const deps = makeDeps({ clientMessageIdRef: { current: null } });
    renderHook(() => useSendRecovery(deps));
    act(() => deps.failureHandlerRef.current());
    // Words still recovered, but nothing to key an idempotent retry on.
    expect(deps.setDraft).toHaveBeenCalled();
    expect(deps.failedSendRef.current).toBeNull();
  });

  it("only surfaces a notice (no recovery) when there is nothing to harvest", () => {
    const deps = makeDeps({ messages: [assistant("just a reply", "a1")] });
    renderHook(() => useSendRecovery(deps));
    act(() => deps.failureHandlerRef.current());
    expect(deps.setMessages).not.toHaveBeenCalled();
    expect(deps.setDraft).not.toHaveBeenCalled();
    expect(deps.failedSendRef.current).toBeNull();
    expect(deps.setSendFailure).toHaveBeenCalledWith({ kind: "generic" });
  });
});

describe("useSendRecovery — resend key resolution", () => {
  it("reuses the failed attempt's key for an untouched retry and mints fresh on an edit", () => {
    const deps = makeDeps({ failedSendRef: { current: { id: "reused-key", text: "hello" } } });
    const { result } = renderHook(() => useSendRecovery(deps));

    // Composer still holds the exact failed words → reuse (server dedupe).
    expect(result.current.resolveResendId("hello")).toBe("reused-key");
    expect(result.current.resolveResendId("  hello  ")).toBe("reused-key");

    // Reworded → a fresh uuid that persists as its own turn.
    const fresh = result.current.resolveResendId("hello, but different");
    expect(fresh).not.toBe("reused-key");
    expect(fresh).toMatch(UUID);
  });
});
