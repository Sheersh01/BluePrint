import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowRight, PenLine } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { TagChip } from "@/components/TagChip";
import { hrefFor } from "@/content/navigation";
import { ALL_TAGS, TAG_BY_ID, TAG_GROUP_LABEL } from "@/content/tags";
import { relatedTags, taggedProblems } from "@/lib/taggedProblems";

export function generateStaticParams() {
  return ALL_TAGS.map((t) => ({ tag: t.id }));
}

export async function generateMetadata(props: PageProps<"/tags/[tag]">): Promise<Metadata> {
  const { tag } = await props.params;
  const t = TAG_BY_ID.get(tag);
  if (!t) return {};
  return { title: `${t.label} — problems`, description: t.description };
}

export default function TagPage(props: PageProps<"/tags/[tag]">) {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <TagContent params={props.params} />
      </Suspense>
    </AppShell>
  );
}

const DIFFICULTY_TONE = { easy: "text-great", medium: "text-good", hard: "text-bad" } as const;

async function TagContent({ params }: { params: Promise<{ tag: string }> }) {
  const { tag: id } = await params;
  const tag = TAG_BY_ID.get(id);
  if (!tag) notFound();

  const problems = taggedProblems().filter((p) => p.tags.some((t) => t.id === id));
  const related = relatedTags(id);

  return (
    <div className="mx-auto max-w-[920px] px-5 pt-12 pb-32 sm:px-10">
      <header className="border-b border-line pb-7">
        <p className="label-caps">
          <Link href="/tags" className="text-primary hover:underline">
            Tags
          </Link>
          <span className="mx-2 text-faint">/</span>
          {TAG_GROUP_LABEL[tag.group]}
        </p>
        <h1 className="mt-3 font-serif text-[40px] leading-[1.05] font-medium tracking-[-0.025em] text-ink sm:text-[48px]">
          {tag.label}
        </h1>
        <p className="mt-3 max-w-[62ch] text-[16px] leading-relaxed text-body">{tag.description}</p>
        <p className="mt-3 text-[13px] text-muted">
          {problems.length} problem{problems.length === 1 ? "" : "s"}
        </p>
        {tag.group === "pattern" && (
          <Link
            href={hrefFor("patterns", tag.id)}
            className="mt-4 inline-flex items-center gap-1.5 text-[14px] text-primary hover:underline"
          >
            Read the {tag.label} pattern <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </header>

      <ul className="mt-8 divide-y divide-line border-y border-line">
        {problems.map((p) => (
          <li key={p.slug} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:gap-6">
            <div className="min-w-0 flex-1">
              <Link href={p.href} className="group inline-flex items-baseline gap-2">
                <span className="font-serif text-[20px] text-ink transition-colors group-hover:text-primary">
                  {p.title}
                </span>
                {p.realLife && <span className="label-caps text-[10px] text-primary">Real interview</span>}
              </Link>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {p.tags
                  .filter((t) => t.id !== id)
                  .map((t) => (
                    <TagChip key={t.id} tag={t} size="sm" />
                  ))}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-4 text-[12px] sm:pt-1.5">
              {p.difficulty && <span className={`capitalize ${DIFFICULTY_TONE[p.difficulty]}`}>{p.difficulty}</span>}
              <Link
                href={`/practice/${p.slug}`}
                className="inline-flex items-center gap-1 text-muted transition-colors hover:text-primary"
              >
                <PenLine className="h-3 w-3" /> Practice
              </Link>
            </div>
          </li>
        ))}
      </ul>

      {related.length > 0 && (
        <section className="mt-10">
          <h2 className="label-caps">Often appears with</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {related.map(({ tag: t, n }) => (
              <TagChip key={t.id} tag={t} count={n} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
