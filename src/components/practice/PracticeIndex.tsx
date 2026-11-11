"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useClientValue } from "@/lib/useClientValue";
import { sessionProgress } from "@/lib/practice/storage";
import { ALL_TAGS, TAG_BY_ID, TAG_GROUP_LABEL, type TagGroup } from "@/content/tags";

export interface PracticeItem {
  slug: string;
  title: string;
  difficulty?: "easy" | "medium" | "hard";
  steps: number;
  /** Heading the item is listed under (e.g. "From real interviews") */
  group: string;
  /** Domain, topic and pattern tag ids */
  tags: string[];
}

const TAG_GROUPS: TagGroup[] = ["domain", "topic", "pattern"];

const DIFFICULTY_TONE = { easy: "text-great", medium: "text-good", hard: "text-bad" } as const;
const DIFFICULTIES = ["all", "easy", "medium", "hard"] as const;

export function PracticeIndex({ items }: { items: PracticeItem[] }) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<(typeof DIFFICULTIES)[number]>("all");
  const [tag, setTag] = useState("");

  // Progress lives in this browser only; read it after hydration.
  const progressKey = useClientValue(() => items.map((i) => JSON.stringify(sessionProgress(i.slug))).join("|"), "");
  const progress = useMemo(() => {
    const parts = progressKey ? progressKey.split("|") : [];
    return Object.fromEntries(
      items.map((it, n) => [it.slug, parts[n] ? (JSON.parse(parts[n]) as ReturnType<typeof sessionProgress>) : null]),
    );
  }, [progressKey, items]);

  const q = query.trim().toLowerCase();
  const shown = items.filter(
    (it) =>
      (level === "all" || it.difficulty === level) &&
      (!tag || it.tags.includes(tag)) &&
      (!q ||
        it.title.toLowerCase().includes(q) ||
        it.tags.some((id) => TAG_BY_ID.get(id)?.label.toLowerCase().includes(q))),
  );
  // Keep the order groups first appear in.
  const groups = [...new Set(shown.map((it) => it.group))].map((name) => ({
    name,
    items: shown.filter((it) => it.group === name),
  }));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-surface px-3 text-[14px] focus-within:border-primary sm:max-w-xs">
          <Search className="h-3.5 w-3.5 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or tag"
            className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-faint focus:outline-none"
          />
        </label>
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          aria-label="Filter by tag"
          className="h-9 rounded-md border border-line bg-surface px-2.5 text-[13px] text-body focus:border-primary focus:outline-none"
        >
          <option value="">All tags</option>
          {TAG_GROUPS.map((g) => (
            <optgroup key={g} label={`${TAG_GROUP_LABEL[g]}s`}>
              {ALL_TAGS.filter((t) => t.group === g).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <div className="flex rounded-md border border-line p-0.5 text-[13px]">
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setLevel(d)}
              className={`rounded-[5px] px-2.5 py-1 capitalize transition-colors ${
                level === d ? "bg-surface-muted text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {groups.map((g) => (
        <section key={g.name} className="mt-8">
          <h2 className="label-caps flex items-baseline justify-between">
            {g.name}
            <span className="font-mono text-[11px] font-normal tracking-normal text-faint">{g.items.length}</span>
          </h2>
          <ul className="mt-3 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
            {g.items.map((it) => {
              const p = progress[it.slug];
              return (
                <li key={it.slug} className="bg-bg">
                  <Link
                    href={`/practice/${it.slug}`}
                    className="group flex h-full items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface-hover"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-serif text-[18px] text-ink transition-colors group-hover:text-primary">
                        {it.title}
                      </span>
                      <span className="mt-0.5 flex gap-2 text-[12px] text-muted">
                        {it.difficulty && <span className={`capitalize ${DIFFICULTY_TONE[it.difficulty]}`}>{it.difficulty}</span>}
                        <span>{it.steps} steps</span>
                      </span>
                    </span>
                    {p && (
                      <span className="shrink-0 text-right text-[12px] leading-tight text-muted">
                        <span className="block text-ink">{p.avg.toFixed(1)} / 4</span>
                        {p.finished ? "completed" : `${p.graded}/${it.steps} graded`}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {shown.length === 0 && <p className="mt-6 text-[14px] text-muted">No problems match that filter.</p>}
    </div>
  );
}
