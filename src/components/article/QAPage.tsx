"use client";

import type { ReactNode } from "react";
import { useStoredValue } from "@/lib/useClientValue";

/**
 * Wraps a Q&A page: a toolbar with the question count and a flashcard switch.
 * Flashcard mode hides every answer until it's revealed (CSS keyed on data-flashcards).
 */
export function QAPage({ count, children }: { count: number; children: ReactNode }) {
  const [mode, setMode] = useStoredValue("bp:flashcards", "off");
  const on = mode === "on";

  return (
    <div data-flashcards={on ? "on" : "off"}>
      <div className="flex items-center justify-between gap-4 border-b border-line pb-4 text-[13px] text-muted">
        <span>
          <span className="font-mono text-ink">{count}</span> questions · answers are interview-length, with links to go deeper
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => setMode(on ? "off" : "on")}
          className="flex shrink-0 items-center gap-2 text-body transition-colors hover:text-ink"
        >
          <span
            className={`relative h-4 w-7 rounded-full border transition-colors ${
              on ? "border-primary bg-primary" : "border-line-strong bg-surface-muted"
            }`}
          >
            <span
              className={`absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-all ${
                on ? "left-[14px] bg-bg" : "left-[2px] bg-faint"
              }`}
            />
          </span>
          Flashcard mode
        </button>
      </div>
      {children}
    </div>
  );
}
