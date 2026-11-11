import type { Article, Block, TocItem } from "./types";
import { bitly } from "./problems/bitly";
import { importedArticles } from "./problems";

/**
 * Every article with real content.
 *   - Bitly is hand-written in problems/bitly.ts.
 *   - Everything else is generated from content-src/raw/<slug>.txt by `npm run import`
 *     (see scripts/import-problem.mjs); per-problem extras live in content-src/overrides/.
 */
export const articles: Article[] = [bitly, ...importedArticles];

export function getArticle(section: string, slug: string) {
  return articles.find((a) => a.section === section && a.slug === slug) ?? null;
}

export function stripInline(text: string) {
  return text
    .replace(/\{\{([^|}]+)\|[^}]+\}\}/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "");
}

export function buildToc(blocks: Block[]): TocItem[] {
  const toc: TocItem[] = [];
  for (const b of blocks) {
    // Q&A pages: every question is a contents entry (nested under a sub-heading when there is one).
    if (b.type === "qa") {
      const entry = { id: b.id, label: `${b.number}. ${stripInline(b.question)}` };
      if (toc.length === 0 || toc[toc.length - 1].qaOnly) toc.push({ ...entry, children: [], qaOnly: true });
      else toc[toc.length - 1].children.push(entry);
      continue;
    }
    if (b.type !== "heading" || b.toc === false) continue;
    const label = stripInline(b.tocLabel ?? b.text);
    // A sub-heading before any top-level heading is promoted so it still appears in the TOC.
    if (b.level === 2 || toc.length === 0) toc.push({ id: b.id, label, children: [] });
    else toc[toc.length - 1].children.push({ id: b.id, label });
  }
  return toc;
}

/** Collects diagram filenames used anywhere in the article (including inside solutions/callouts). */
export function collectDiagramFiles(blocks: Block[], out = new Set<string>()) {
  for (const b of blocks) {
    if (b.type === "diagram") out.add(b.file);
    if (b.type === "callout") collectDiagramFiles(b.blocks, out);
    if (b.type === "solution") {
      collectDiagramFiles(b.approach, out);
      collectDiagramFiles(b.challenges, out);
    }
  }
  return out;
}
