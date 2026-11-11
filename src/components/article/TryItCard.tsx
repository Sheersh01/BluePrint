"use client";

import { SquarePen, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function TryItCard({
  eyebrow,
  question,
  answerTarget,
  backdrop,
}: {
  eyebrow: string;
  question: string;
  answerTarget?: string;
  backdrop?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative my-10 overflow-hidden rounded-[5px] bg-surface-muted px-6 py-7 sm:px-8">
      {backdrop && (
        <div
          aria-hidden
          className="diagram-svg pointer-events-none absolute -right-16 -bottom-10 w-[420px] opacity-[0.08]"
          dangerouslySetInnerHTML={{ __html: backdrop }}
        />
      )}
      <p className="label-caps relative text-primary!">Pause and think · {eyebrow}</p>
      <p className="relative mt-2 max-w-[34ch] font-serif text-[24px] leading-snug font-medium text-ink">{question}</p>
      <p className="relative mt-2 max-w-[52ch] text-[14px] leading-relaxed text-muted">
        Sketch your own answer before reading on — it&apos;s the fastest way to find out what you actually know.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative mt-5 inline-flex items-center gap-2 rounded-[4px] bg-ink px-4 py-2 text-[14px] font-medium text-bg transition-colors hover:bg-primary"
      >
        <SquarePen className="h-4 w-4" strokeWidth={1.75} /> Write your answer
      </button>
      {open && <PracticeModal question={question} answerTarget={answerTarget} onClose={() => setOpen(false)} />}
    </div>
  );
}

function PracticeModal({
  question,
  answerTarget,
  onClose,
}: {
  question: string;
  answerTarget?: string;
  onClose: () => void;
}) {
  const key = `hi:practice:${question}`;
  // Mounted only after a click, so reading storage in the initializer is safe.
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = (v: string) => {
    setText(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      /* ignore */
    }
  };

  const reveal = () => {
    onClose();
    if (answerTarget) {
      requestAnimationFrame(() => document.getElementById(answerTarget)?.scrollIntoView({ behavior: "smooth" }));
    }
  };

  return createPortal(
    <div className="animate-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-ink/25 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Practice question"
        className="animate-pop-in w-full max-w-2xl rounded-md border border-line-strong bg-surface shadow-[0_16px_48px_-16px_rgba(28,26,23,0.35)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <p className="label-caps text-primary!">Your answer</p>
            <h3 className="mt-1 font-serif text-[22px] leading-snug font-medium text-ink">{question}</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted hover:bg-surface-hover">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-5">
          <label htmlFor="practice-answer" className="text-sm text-body">
            Write your answer the way you would on the whiteboard. Your notes are saved in this browser.
          </label>
          <textarea
            id="practice-answer"
            autoFocus
            value={text}
            onChange={(e) => save(e.target.value)}
            rows={9}
            placeholder={"- Low latency redirects (< 100ms)\n- ..."}
            className="mt-3 w-full resize-y rounded-[4px] border border-line bg-bg p-3 font-mono text-[13px] leading-6 text-ink outline-none focus:border-primary"
          />
          <p className="mt-1 text-right text-xs text-faint">{text.trim() ? `${text.trim().split(/\s+/).length} words` : ""}</p>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:justify-end">
          <button onClick={onClose} className="rounded-[4px] px-4 py-2 text-sm font-medium text-body hover:bg-surface-hover">
            Keep reading
          </button>
          <button
            onClick={reveal}
            className="rounded-[4px] bg-ink px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-primary"
          >
            Compare with the answer
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
