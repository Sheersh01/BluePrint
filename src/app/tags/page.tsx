import type { Metadata } from "next";
import { AppShell } from "@/components/shell/AppShell";
import { TagChip, TagLegend } from "@/components/TagChip";
import { ALL_TAGS, TAG_GROUP_LABEL, type TagGroup } from "@/content/tags";
import { tagCounts, taggedProblems } from "@/lib/taggedProblems";

export const metadata: Metadata = {
  title: "Browse by tag",
  description: "Every system design problem, organized by domain, technical topic and pattern.",
};

const GROUP_INTRO: Record<TagGroup, string> = {
  domain: "What kind of product the problem is about.",
  topic: "The technical ideas a problem exercises — the things interviewers dig into.",
  pattern: "The reusable patterns each problem leans on, linked to their write-ups.",
};

export default function TagsIndex() {
  const counts = tagCounts();
  const total = taggedProblems().length;
  const groups: TagGroup[] = ["domain", "topic", "pattern"];

  return (
    <AppShell>
      <div className="mx-auto max-w-[920px] px-5 pt-12 pb-32 sm:px-10">
        <header className="border-b border-line pb-7">
          <p className="label-caps text-primary">Tags</p>
          <h1 className="mt-3 font-serif text-[40px] leading-[1.05] font-medium tracking-[-0.025em] text-ink sm:text-[48px]">
            Browse problems by tag
          </h1>
          <p className="mt-4 max-w-[62ch] text-[16px] leading-relaxed text-body">
            All {total} problems are tagged three ways. Pick a tag to see every problem that shares it — the fastest
            way to practise one idea (say, geospatial indexing) across several designs.
          </p>
          <div className="mt-4">
            <TagLegend />
          </div>
        </header>

        {groups.map((g) => {
          const tags = ALL_TAGS.filter((t) => t.group === g).sort(
            (a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.label.localeCompare(b.label),
          );
          return (
            <section key={g} className="mt-10">
              <h2 className="font-serif text-[26px] font-medium tracking-[-0.02em] text-ink">
                {TAG_GROUP_LABEL[g]}s
                <span className="ml-2 font-mono text-[12px] tracking-normal text-faint">{tags.length}</span>
              </h2>
              <p className="mt-1 text-[14px] text-muted">{GROUP_INTRO[g]}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {tags.map((t) => (
                  <TagChip key={t.id} tag={t} count={counts.get(t.id) ?? 0} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </AppShell>
  );
}
