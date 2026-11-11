"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

/** The article's own write-up for the current step, shown over the workspace. */
export function SampleAnswerDialog({
  question,
  children,
  empty,
  onClose,
}: {
  question: string;
  children: ReactNode;
  empty: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-center" role="dialog" aria-modal="true" aria-label="Sample answer">
      <div className="animate-fade-in absolute inset-0 bg-ink/30" onClick={onClose} />
      <div className="animate-pop-in relative m-3 flex w-full max-w-[780px] flex-col overflow-hidden rounded-lg border border-line-strong bg-bg shadow-[0_24px_60px_-24px_rgba(28,26,23,0.45)] sm:m-8">
        <header className="flex items-start gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="label-caps">Sample answer</p>
            <h2 className="mt-1 font-serif text-[22px] leading-snug text-ink">{question}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="thin-scroll prose-bp flex-1 overflow-y-auto px-6 py-6">
          {empty ? (
            <p className="hi-p text-muted">
              The breakdown doesn&apos;t include a written answer for this step. Use the feedback and your own judgment —
              then compare with the final design in the full article.
            </p>
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
}
