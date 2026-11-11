import "server-only";
import { hrefFor, navigation } from "@/content/navigation";
import { getArticle } from "@/content/registry";
import { ALL_TAGS, tagsForProblem, type Tag } from "@/content/tags";

export interface TaggedProblem {
  slug: string;
  section: string;
  title: string;
  href: string;
  difficulty?: "easy" | "medium" | "hard";
  realLife: boolean;
  tags: Tag[];
}

const TAGGED_SECTIONS = ["problem-breakdowns", "real-life"];

/** Every problem (standard and real-life) with its full tag list, in sidebar order. */
export function taggedProblems(): TaggedProblem[] {
  return navigation
    .filter((s) => TAGGED_SECTIONS.includes(s.section))
    .flatMap((s) =>
      s.items.flatMap((item) => {
        const article = getArticle(s.section, item.slug);
        if (!article) return [];
        return [
          {
            slug: item.slug,
            section: s.section,
            title: article.title,
            href: hrefFor(s.section, item.slug),
            difficulty: article.difficulty,
            realLife: s.section === "real-life",
            tags: tagsForProblem(item.slug, article.tags.map((t) => t.label)),
          },
        ];
      }),
    );
}

/** How many problems carry each tag. */
export function tagCounts() {
  const counts = new Map<string, number>(ALL_TAGS.map((t) => [t.id, 0]));
  for (const p of taggedProblems()) for (const t of p.tags) counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
  return counts;
}

/** Tags that most often appear together with `id` — a quick map of how ideas connect. */
export function relatedTags(id: string, limit = 8) {
  const together = new Map<string, number>();
  for (const p of taggedProblems()) {
    if (!p.tags.some((t) => t.id === id)) continue;
    for (const t of p.tags) if (t.id !== id) together.set(t.id, (together.get(t.id) ?? 0) + 1);
  }
  return [...together.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tagId, n]) => ({ tag: ALL_TAGS.find((t) => t.id === tagId)!, n }));
}
