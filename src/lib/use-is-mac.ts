"use client";

import { useEffect, useState } from "react";

// SSR and the first client render agree on `false` (Ctrl+↵) so hydration
// never sees a mismatched attribute; the real platform lands after mount.
export function useIsMac(): boolean {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    // The one deliberate cascade: a browser-only read (navigator.platform) must
    // NOT run during SSR/first render or hydration would mismatch, so it's
    // deferred to a mount-only effect. One extra render, on purpose.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMac(/Mac|iP(hone|ad|od)/.test(navigator.platform));
  }, []);
  return isMac;
}
