import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { hrefFor, sectionOf } from "@/content/navigation";
import { articles, buildToc, collectDiagramFiles, getArticle } from "@/content/registry";
import { loadDiagrams } from "@/lib/diagrams";
import { ArticleHeader } from "@/components/article/ArticleHeader";
import { Blocks } from "@/components/article/Blocks";
import { ReadingChrome } from "@/components/article/RightRail";
import { HashScroll } from "@/components/article/HashScroll";
import { QAPage } from "@/components/article/QAPage";

export function generateStaticParams() {
  return articles.map(({ section, slug }) => ({ section, slug }));
}

export async function generateMetadata(props: PageProps<"/learn/system-design/[section]/[slug]">): Promise<Metadata> {
  const { section, slug } = await props.params;
  const article = getArticle(section, slug);
  if (!article) return {};
  // Older scraped titles may still carry the previous site name.
  const title = article.seoTitle.replace(/\s*\|\s*Hello Interview.*$/, "");
  return { title, description: article.description };
}

export default function LearnPage(props: PageProps<"/learn/system-design/[section]/[slug]">) {
  return (
    <Suspense fallback={<ArticleSkeleton />}>
      <LearnContent params={props.params} />
    </Suspense>
  );
}

function ArticleSkeleton() {
  return (
    <div className="mx-auto max-w-[1080px] animate-pulse px-5 pt-12 sm:px-10">
      <div className="max-w-[700px] space-y-4">
        <div className="h-3 w-24 rounded-sm bg-surface-muted" />
        <div className="h-11 w-72 rounded-sm bg-surface-muted" />
        <div className="h-4 w-full rounded-sm bg-surface-muted" />
      </div>
    </div>
  );
}

async function LearnContent({ params }: { params: Promise<{ section: string; slug: string }> }) {
  const { section, slug } = await params;
  const article = getArticle(section, slug);
  if (!article) notFound();

  const files = collectDiagramFiles(article.blocks);
  // The faint sketch behind "Pause and think" is the article's last (usually final-design) diagram.
  const backdropFile = [...files].at(-1);
  const diagrams = await loadDiagrams(article.slug, files);
  const toc = buildToc(article.blocks);

  const sec = sectionOf(section);
  const pos = sec?.items.findIndex((i) => i.slug === slug) ?? -1;
  const prev = sec && pos > 0 ? sec.items[pos - 1] : null;
  const next = sec && pos >= 0 && pos < sec.items.length - 1 ? sec.items[pos + 1] : null;

  return (
    <div className="mx-auto flex max-w-[1080px] gap-14 px-5 pt-12 pb-32 sm:px-10">
      <article className="min-w-0 max-w-[700px] flex-1">
        <HashScroll />
        <ArticleHeader article={article} />
        <div className="prose-bp mt-10">
          {section === "questions" ? (
            <QAPage count={article.blocks.filter((b) => b.type === "qa").length}>
              <Blocks blocks={article.blocks} ctx={{ diagrams }} />
            </QAPage>
          ) : (
            <Blocks
              blocks={article.blocks}
              ctx={{ diagrams, quiz: article.quiz, backdrop: backdropFile ? diagrams[backdropFile] : undefined }}
            />
          )}
        </div>

        {(prev || next) && (
          <nav className="mt-20 grid grid-cols-2 gap-6 border-t border-line pt-6" aria-label="More in this section">
            <div>
              {prev && (
                <Link href={hrefFor(section, prev.slug)} className="group block">
                  <span className="label-caps">Previous</span>
                  <span className="mt-1 block font-serif text-[20px] text-ink transition-colors group-hover:text-primary">
                    {prev.title}
                  </span>
                </Link>
              )}
            </div>
            <div className="text-right">
              {next && (
                <Link href={hrefFor(section, next.slug)} className="group block">
                  <span className="label-caps">Next</span>
                  <span className="mt-1 block font-serif text-[20px] text-ink transition-colors group-hover:text-primary">
                    {next.title}
                  </span>
                </Link>
              )}
            </div>
          </nav>
        )}
      </article>
      <ReadingChrome toc={toc} pageHref={hrefFor(section, slug)} />
    </div>
  );
}
