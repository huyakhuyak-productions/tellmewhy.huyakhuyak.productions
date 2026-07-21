"use client";

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { UIMessage } from "ai";
import { harvestFailedSend, mergeRestoredDraft, resendMessageId } from "@/lib/send-recovery";

// A failed send, kept as an object (not a plain string) so every failure gets
// a fresh identity — consecutive identical failures must still re-run the
// restore/focus effect in the host.
export type SendFailure = { kind: "rate-limit" | "generic" };

// The last failed send's idempotency key + the exact words it carried.
export type FailedSend = { id: string; text: string };

// Wire up send-failure recovery. The host owns the useChat instance (hence the
// two refs it passes in — `failureHandlerRef` is captured by useChat's onError
// and `failedSendRef` is cleared by its onFinish, both defined before this hook
// can run), the composer draft, and the idempotency key. This hook owns the one
// place that turns a failure into a recovered composer draft (harvest the failed
// words, merge them back without clobbering in-flight typing, drop the failed
// tail, stash the key for an unedited retry) and the resend-key decision.
export function useSendRecovery<M extends UIMessage>({
  messages,
  setMessages,
  setDraft,
  setSendFailure,
  rateLimited,
  draftKey,
  clientMessageIdRef,
  failedSendRef,
  failureHandlerRef,
}: {
  messages: M[];
  setMessages: (messages: M[] | ((messages: M[]) => M[])) => void;
  setDraft: Dispatch<SetStateAction<string>>;
  setSendFailure: Dispatch<SetStateAction<SendFailure | null>>;
  /** Whether the most recent /api/chat response was the rate limiter's 429. */
  rateLimited: MutableRefObject<boolean>;
  /** sessionStorage key holding the hero hand-off draft, cleared once recovered. */
  draftKey: string;
  /** The key the failing attempt POSTed with — paired to its words on stash. */
  clientMessageIdRef: MutableRefObject<string | null>;
  /** Owned by the host (cleared in onFinish); this hook stashes into it. */
  failedSendRef: MutableRefObject<FailedSend | null>;
  /** Owned by the host (captured by useChat's onError); this hook fills it. */
  failureHandlerRef: MutableRefObject<() => void>;
}) {
  // A failed send must never cost the writer their words. When the SDK reports
  // an error, move the failed message (and any partial reply the dying stream
  // left behind) out of the thread and back into the composer, then surface a
  // calm notice. sendMessage always appends a fresh user message, so leaving the
  // failed copy in the thread would duplicate it on retry. The thread read is
  // safe: sendMessage pushes the user message and React commits (re-syncing this
  // ref) before the request can possibly fail.
  //
  // Synced every render (no deps) so the handler always closes over the freshest
  // `messages` — useChat's onError only ever invokes `failureHandlerRef.current`.
  useEffect(() => {
    failureHandlerRef.current = () => {
      const failure = harvestFailedSend(messages);
      if (failure) {
        // Remember the key this attempt POSTed with, paired to its words, so an
        // unedited retry can reuse it (server dedupe → one row) while an edited
        // retry mints fresh. Only a real client-text attempt stashes a key —
        // clientMessageIdRef is always set by the send path that just failed.
        if (clientMessageIdRef.current) {
          failedSendRef.current = { id: clientMessageIdRef.current, text: failure.failedText };
        }
        setDraft((current) => mergeRestoredDraft(failure.failedText, current));
        setMessages(failure.messagesWithoutFailure);
        // The words now live in the composer — the stashed hero draft (if
        // any) is recovered and must not auto-resend on a later remount.
        sessionStorage.removeItem(draftKey);
      }
      setSendFailure({ kind: rateLimited.current ? "rate-limit" : "generic" });
    };
  });

  return {
    // Reuse the failed attempt's key on an untouched retry (server dedupe onto
    // the one persisted row); any edit or fresh send mints a new key. The
    // unedited-vs-edited decision lives in one pure, unit-tested place.
    resolveResendId: (draft: string) => resendMessageId(failedSendRef.current, draft),
  };
}
