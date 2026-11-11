"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { allNavRoutes, hrefFor } from "@/content/navigation";
import questionIndex from "@/content/problems/questions.json";
import { ALL_TAGS, PROBLEM_TAGS, TAG_BY_ID, TAG_GROUP_LABEL, tagHref } from "@/content/tags";

interface Result {
  kind: "page" | "heading" | "tag";
  title: string;
  group: string;
  href: string;
  /** Tag labels a problem carries, so searching "geospatial" also finds Uber, Yelp… */
  keywords?: string[];
  /** Small right-aligned hint (e.g. which tag matched) */
  hint?: string;
}

const pages: Result[] = allNavRoutes().map((r) => ({
  kind: "page",
  title: r.title,
  group: r.group,
  href: hrefFor(r.section, r.slug),
  keywords: [...(PROBLEM_TAGS[r.slug]?.domains ?? []), ...(PROBLEM_TAGS[r.slug]?.topics ?? [])].map(
    (id) => TAG_BY_ID.get(id)?.label ?? id,
  ),
}));

const tagResults: Result[] = ALL_TAGS.map((t) => ({
  kind: "tag",
  title: t.label,
  group: "Tags",
  href: tagHref(t.id),
  hint: TAG_GROUP_LABEL[t.group],
}));

// Q&A questions are searchable from anywhere (one small generated list).
const questions: Result[] = questionIndex.map((x) => ({
  kind: "heading",
  title: `${x.n}. ${x.q}`,
  group: "Question",
  href: `${hrefFor("questions", x.slug)}#${x.id}`,
}));

function score(title: string, q: string) {
  const t = title.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.split(/\s+/).some((w) => w.startsWith(q))) return 60;
  if (t.includes(q)) return 40;
  // tolerate simple suffix differences, e.g. "cache" → "caching"
  const stem = q.slice(0, Math.max(3, q.length - 1));
  return q.length >= 4 && t.split(/\s+/).some((w) => w.startsWith(stem)) ? 20 : 0;
}

function indexHeadings(): Result[] {
  // Index the headings (and solution cards) of whatever article is on screen.
  const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-anchor], [data-search]"));
  const title = document.querySelector("h1")?.textContent ?? "This page";
  return nodes.map((n) => ({
    kind: "heading" as const,
    title: n.dataset.label || n.textContent || "",
    group: `In ${title}`,
    href: `${location.pathname}#${n.id}`,
  }));
}

/** Mounted only while open, so state starts fresh each time. */
export function SearchDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [headings] = useState<Result[]>(indexHeadings);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo<Result[]>(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [...headings.slice(0, 6), ...pages];
    const onPage = new Set(headings.map((h) => h.href));
    return [...tagResults, ...headings, ...questions.filter((x) => !onPage.has(x.href)), ...pages]
      .map((r) => {
        const own = score(r.title, query);
        // A problem also matches through its tags ("payments" → Payment System, Digital Wallet…).
        const viaTag = r.keywords?.find((k) => score(k, query) >= 40);
        const s = Math.max(own, viaTag ? 30 : 0) + (r.kind === "page" ? 3 : 0) + (r.kind === "tag" ? 5 : 0);
        return { r: viaTag && own < 30 ? { ...r, hint: viaTag } : r, s };
      })
      .filter((x) => x.s > 3)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.r);
  }, [q, headings]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const go = (r: Result | undefined) => {
    if (!r) return;
    onClose();
    router.push(r.href);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[sel]);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[60] flex items-start justify-center bg-ink/20 px-4 pt-[14vh]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="animate-pop-in w-full max-w-lg overflow-hidden rounded-md border border-line-strong bg-surface shadow-[0_12px_40px_-12px_rgba(28,26,23,0.25)]"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="h-4 w-4 text-muted" strokeWidth={2} />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            placeholder="Search problems, tags, patterns, technologies…"
            className="h-12 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">esc</kbd>
        </div>
        <ul ref={listRef} className="thin-scroll max-h-[55vh] overflow-y-auto py-2">
          {results.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted">Nothing matches “{q}”.</li>}
          {results.map((r, i) => {
            const header = i === 0 || results[i - 1].group !== r.group ? r.group : null;
            return (
              <li key={r.href + i}>
                {header && <p className="label-caps px-4 pt-3 pb-1.5">{header}</p>}
                <button
                  data-idx={i}
                  onMouseMove={() => setSel(i)}
                  onClick={() => go(r)}
                  className={`relative flex w-full items-center gap-3 px-4 py-2 text-left text-[14px] ${
                    sel === i ? "bg-surface-muted text-ink" : "text-body"
                  }`}
                >
                  {sel === i && <span className="absolute inset-y-1.5 left-0 w-[2px] bg-primary" />}
                  <span className={`flex-1 truncate ${r.kind === "heading" ? "text-[13px]" : ""}`}>{r.title}</span>
                  {r.hint && <span className="shrink-0 truncate text-[11px] text-faint">{r.hint}</span>}
                  {sel === i && <CornerDownLeft className="h-3.5 w-3.5 text-muted" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
