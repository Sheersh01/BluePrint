"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { StepMeta } from "@/lib/practice/steps";
import { SCORE_LABEL, scoreTone, type StepRecord } from "@/lib/practice/storage";

const DOT_BG = {
  faint: "bg-line-strong",
  bad: "bg-bad",
  good: "bg-good",
  great: "bg-great",
} as const;

/** ‹ ● ● ● › — one dot per step, colored by its latest score. */
export function StepNav({
  steps,
  records,
  current,
  onGo,
}: {
  steps: StepMeta[];
  records: Record<string, StepRecord>;
  current: number;
  onGo: (i: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onGo(current - 1)}
        disabled={current === 0}
        aria-label="Previous step"
        className="rounded-md p-1 text-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <ol className="flex flex-1 flex-wrap items-center justify-center gap-x-1 gap-y-1">
        {steps.map((s, i) => {
          const rec = records[s.id];
          const score = rec?.feedback?.score;
          const tone = scoreTone(score);
          const active = i === current;
          const status = score ? SCORE_LABEL[score] : rec?.skipped ? "Skipped" : "Not answered";
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onGo(i)}
                aria-current={active ? "step" : undefined}
                title={`${i + 1}. ${s.chip} — ${status}`}
                className="group grid h-6 w-6 place-items-center rounded-full"
              >
                <span
                  className={`block rounded-full transition-all ${DOT_BG[tone]} ${
                    active ? "h-3 w-3 ring-2 ring-ink ring-offset-2 ring-offset-bg" : "h-2.5 w-2.5 group-hover:scale-125"
                  } ${rec?.skipped && !score ? "opacity-50" : ""}`}
                />
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={() => onGo(current + 1)}
        disabled={current === steps.length - 1}
        aria-label="Next step"
        className="rounded-md p-1 text-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
