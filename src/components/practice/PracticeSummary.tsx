"use client";

import Link from "next/link";
import type { StepMeta } from "@/lib/practice/steps";
import { SCORE_LABEL, scoreTone, type StepRecord } from "@/lib/practice/storage";

const TONE_BG = { faint: "bg-line-strong", bad: "bg-bad", good: "bg-good", great: "bg-great" } as const;
const TONE_TEXT = { faint: "text-faint", bad: "text-bad", good: "text-good", great: "text-great" } as const;

export function PracticeSummary({
  steps,
  records,
  articleHref,
  onReview,
  onRestart,
}: {
  slug: string;
  steps: StepMeta[];
  records: Record<string, StepRecord>;
  articleHref: string;
  onReview: (i: number) => void;
  onRestart: () => void;
}) {
  const graded = steps.filter((s) => records[s.id]?.feedback);
  const avg = graded.length
    ? graded.reduce((n, s) => n + records[s.id].feedback!.score, 0) / graded.length
    : 0;
  const weakest = graded
    .filter((s) => records[s.id].feedback!.score <= 2)
    .map((s) => steps.indexOf(s));

  return (
    <div>
      <p className="label-caps text-primary">Session complete</p>
      <h1 className="mt-2 font-serif text-[28px] leading-tight font-medium text-ink">
        {graded.length === 0 ? "No steps graded yet" : `Average ${avg.toFixed(1)} / 4`}
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-body">
        {graded.length === 0
          ? "You haven't asked for feedback on any step yet. Pick one below to answer it."
          : `You got feedback on ${graded.length} of ${steps.length} steps.` +
            (weakest.length ? " The steps marked below are worth another pass." : " Solid run — try it again in a few days from a blank board.")}
      </p>

      <ol className="mt-6 divide-y divide-line border-y border-line">
        {steps.map((s, i) => {
          const rec = records[s.id];
          const score = rec?.feedback?.score;
          const tone = scoreTone(score);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onReview(i)}
                className="flex w-full items-start gap-3 py-3 text-left transition-colors hover:bg-surface-hover"
              >
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${TONE_BG[tone]}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11.5px] text-muted">{s.chip}</span>
                  <span className="block text-[14px] leading-snug text-ink">{s.question}</span>
                </span>
                <span className={`shrink-0 text-[12px] ${TONE_TEXT[tone]}`}>
                  {score ? SCORE_LABEL[score] : rec?.skipped ? "Skipped" : "—"}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href={articleHref}
          className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-bg transition-opacity hover:opacity-90"
        >
          Read the full breakdown
        </Link>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Clear all answers and feedback for this problem? The whiteboard is kept.")) onRestart();
          }}
          className="rounded-md border border-line px-4 py-2 text-[13px] text-body transition-colors hover:border-line-strong hover:text-ink"
        >
          Start over
        </button>
      </div>
    </div>
  );
}
