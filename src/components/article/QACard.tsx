"use client";

import { Eye } from "lucide-react";
import { useState, type ReactNode } from "react";

const LEVEL = { B: "Basic", I: "Intermediate", A: "Advanced" } as const;

/** One question from the Questions bank. In flashcard mode the answer stays hidden until revealed. */
export function QACard({
  id,
  number,
  qtype,
  level,
  question,
  children,
}: {
  id: string;
  number: number;
  qtype: string;
  level: keyof typeof LEVEL;
  question: string;
  children: ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <section
      id={id}
      data-anchor=""
      data-label={`${number}. ${question}`}
      data-revealed={revealed ? "true" : undefined}
      className="qa-card group/qa my-6 scroll-mt-[84px] border-t border-line pt-6"
    >
      <div className="flex items-baseline gap-4">
        <span className="w-8 shrink-0 font-mono text-[12px] text-faint">{String(number).padStart(2, "0")}</span>
        <div className="min-w-0 flex-1">
          <p className="label-caps flex flex-wrap items-center gap-2 text-[10px]!">
            <span className="text-primary">{qtype}</span>
            <span className="text-faint">/</span>
            <span>{LEVEL[level]}</span>
          </p>
          <h3 className="mt-1.5 font-serif text-[22px] leading-snug font-medium tracking-[-0.01em] text-ink">{question}</h3>

          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="qa-reveal mt-3 items-center gap-1.5 rounded-[4px] border border-line px-3 py-1.5 text-[13px] text-body transition-colors hover:border-primary hover:text-primary"
          >
            <Eye className="h-3.5 w-3.5" strokeWidth={1.75} /> Reveal answer
          </button>

          <div className="qa-answer hi-flow mt-3 text-[16px]">{children}</div>
        </div>
      </div>
    </section>
  );
}
