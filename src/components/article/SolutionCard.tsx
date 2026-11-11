"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

const VERDICT = {
  bad: { label: "Weak approach", rule: "bg-bad", text: "text-bad" },
  good: { label: "Good approach", rule: "bg-good", text: "text-good" },
  great: { label: "Strong approach", rule: "bg-great", text: "text-great" },
} as const;

export function SolutionCard({
  verdict,
  title,
  children,
}: {
  verdict: keyof typeof VERDICT;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const id = useId();
  const v = VERDICT[verdict];
  const slug = `${verdict}-solution-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
  return (
    <section
      id={slug}
      data-search={`${v.label}: ${title}`}
      data-label={`${v.label}: ${title}`}
      className="relative my-7 scroll-mt-[84px] overflow-hidden rounded-[5px] border border-line bg-surface"
    >
      <span className={`absolute inset-y-0 left-0 w-[3px] ${v.rule}`} aria-hidden />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-start justify-between gap-4 py-4 pr-5 pl-6 text-left"
      >
        <span>
          <span className={`label-caps block !text-[10px] ${v.text}`}>{v.label}</span>
          <span className="mt-1 block font-serif text-[20px] leading-snug font-medium text-ink">{title}</span>
        </span>
        <ChevronDown
          className={`mt-1 h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>
      {open && (
        <div id={id} className="hi-flow border-t border-line pt-4 pr-6 pb-6 pl-6 text-[16px]">
          {children}
        </div>
      )}
    </section>
  );
}
