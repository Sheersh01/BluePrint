"use client";

import Link from "next/link";
import { ChevronDown, PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Article } from "@/content/types";
import { sectionOf } from "@/content/navigation";
import { isPracticeSection } from "@/lib/practice/sections";
import { tagsForProblem } from "@/content/tags";
import { TagChip } from "@/components/TagChip";

const DIFFICULTY_TONE = {
  easy: "text-great",
  medium: "text-good",
  hard: "text-bad",
} as const;

export function ArticleHeader({ article }: { article: Article }) {
  const [showDates, setShowDates] = useState(false);
  const datesRef = useRef<HTMLDivElement>(null);
  const kind = sectionOf(article.section)?.singular ?? article.category;
  const problemTags = isPracticeSection(article.section)
    ? tagsForProblem(article.slug, article.tags.map((t) => t.label))
    : [];

  useEffect(() => {
    if (!showDates) return;
    const close = (e: MouseEvent) => {
      if (!datesRef.current?.contains(e.target as Node)) setShowDates(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showDates]);

  const asked = article.askedAt;
  const askedText = asked
    ? [asked.companies.join(", "), asked.more ? `+${asked.more} more` : ""].filter(Boolean).join(" ")
    : "";

  return (
    <header className="border-b border-line pb-7">
      <p className="label-caps flex items-center gap-2">
        <span className="text-primary">{kind}</span>
        {article.difficulty && (
          <>
            <span className="text-faint">/</span>
            <span className={DIFFICULTY_TONE[article.difficulty]}>{article.difficulty}</span>
          </>
        )}
      </p>
      <h1 className="mt-3 font-serif text-[40px] leading-[1.05] font-medium tracking-[-0.025em] text-ink sm:text-[48px]">
        {article.title}
      </h1>
      {article.subtitle && (
        <p className="mt-3 max-w-[60ch] font-serif text-[19px] leading-snug text-body italic">{article.subtitle}</p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted">
        {article.author && <span className="text-body">{article.author}</span>}
        <div ref={datesRef} className="relative">
          <button
            onClick={() => setShowDates((s) => !s)}
            className="inline-flex items-center gap-1 transition-colors hover:text-ink"
            aria-expanded={showDates}
          >
            {article.updatedLabel ?? "Updated"} {article.updated}
            <ChevronDown className={`h-3 w-3 transition-transform ${showDates ? "rotate-180" : ""}`} />
          </button>
          {showDates && (
            <div className="animate-pop-in absolute top-full left-0 z-20 mt-2 w-52 rounded-md border border-line-strong bg-surface p-3 text-[12px] shadow-[0_8px_24px_-12px_rgba(28,26,23,0.3)]">
              <div className="flex justify-between py-0.5">
                <span className="text-muted">Published</span>
                <span className="text-ink">{article.published}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-muted">Last updated</span>
                <span className="text-ink">{article.updated}</span>
              </div>
            </div>
          )}
        </div>
        {askedText && (
          <span>
            Asked at <span className="text-body">{askedText}</span>
          </span>
        )}
      </div>

      {isPracticeSection(article.section) && (
        <Link
          href={`/practice/${article.slug}`}
          className="group mt-5 inline-flex items-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 py-2 text-[13.5px] text-ink transition-colors hover:border-primary hover:text-primary"
        >
          <PenLine className="h-3.5 w-3.5" strokeWidth={2} />
          {article.section === "real-life" ? "Practice this question" : "Practice this problem"} on a whiteboard
          <span className="transition-transform group-hover:translate-x-0.5">→</span>
        </Link>
      )}

      {problemTags.length > 0 ? (
        // Problems: domain, topic and pattern tags, each linking to its tag page.
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {problemTags.map((t) => (
            <TagChip key={t.id} tag={t} />
          ))}
          <Link href="/tags" className="text-[12px] text-muted transition-colors hover:text-primary">
            All tags →
          </Link>
        </div>
      ) : (
        article.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {article.tags.map((t) => (
              <Link
                key={t.label}
                href={t.href}
                className="rounded-[3px] border border-line px-2 py-0.5 text-[12px] text-body transition-colors hover:border-primary hover:text-primary"
              >
                {t.label}
              </Link>
            ))}
          </div>
        )
      )}
    </header>
  );
}
