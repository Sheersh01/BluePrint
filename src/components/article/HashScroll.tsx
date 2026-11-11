"use client";

import { useEffect } from "react";

/**
 * The browser jumps to `#anchor` before web fonts finish loading, and the text reflow
 * afterwards leaves the target off-screen. Re-align once fonts are ready.
 */
export function HashScroll() {
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) document.getElementById(id)?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
