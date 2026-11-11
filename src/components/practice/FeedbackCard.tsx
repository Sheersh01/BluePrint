"use client";

import { Check, Plus, X } from "lucide-react";
import type { Feedback } from "@/lib/practice/schema";
import { SCORE_HEADLINE } from "@/lib/practice/storage";

const SEGMENTS = ["bg-bad", "bg-good", "bg-great/70", "bg-great"] as const;

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex gap-1" role="img" aria-label={`Score ${score} out of 4`}>
      {SEGMENTS.map((c, i) => (
        <span key={i} className={`h-1.5 flex-1 rounded-full ${i < score ? c : "bg-surface-muted"}`} />
      ))}
    </div>
  );
}

function Section({
  title,
  items,
  icon,
}: {
  title: string;
  items: string[];
  icon: "check" | "x" | "plus";
}) {
  if (items.length === 0) return null;
  const Icon = icon === "check" ? Check : icon === "x" ? X : Plus;
  const tone = icon === "check" ? "bg-great" : icon === "x" ? "bg-bad" : "bg-good";
  return (
    <section className="mt-6">
      <h3 className="font-serif text-[18px] font-medium text-ink">{title}</h3>
      <ul className="mt-3 space-y-3">
        {items.map((t, i) => (
          <li key={i} className="flex gap-3 text-[14.5px] leading-relaxed text-body">
            <span className={`mt-[3px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full ${tone}`}>
              <Icon className="h-3 w-3 text-bg" strokeWidth={3} />
            </span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FeedbackCard({
  feedback,
  imageReviewed,
  attempts,
  model,
}: {
  feedback: Feedback;
  imageReviewed?: boolean;
  attempts: number;
  model?: string;
}) {
  return (
    <div>
      <p className="font-serif text-[20px] leading-snug text-ink">{SCORE_HEADLINE[feedback.score]}</p>
      <div className="mt-3">
        <ScoreBar score={feedback.score} />
      </div>
      <p className="mt-2 text-[12px] text-faint">
        Attempt {attempts}
        {model && <> · reviewed by {model}</>}
        {imageReviewed === false && " · your drawing wasn't reviewed, only its text labels"}
      </p>
      <Section title="What went well" items={feedback.wentWell} icon="check" />
      <Section title="What needs improvement" items={feedback.needsImprovement} icon="x" />
      <Section title="Minor suggestions" items={feedback.minorSuggestions} icon="plus" />
    </div>
  );
}
