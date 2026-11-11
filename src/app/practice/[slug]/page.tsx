import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { collectDiagramFiles } from "@/content/registry";
import { hrefFor } from "@/content/navigation";
import { loadDiagrams } from "@/lib/diagrams";
import { buildPracticePlan, getPracticeArticle, practiceArticles, toMeta } from "@/lib/practice/steps";
import { Blocks } from "@/components/article/Blocks";
import { PracticeClient, WorkspaceSkeleton } from "@/components/practice/PracticeClient";

export function generateStaticParams() {
  return practiceArticles().map(({ slug }) => ({ slug }));
}

export async function generateMetadata(props: PageProps<"/practice/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const article = getPracticeArticle(slug);
  if (!article) return {};
  return {
    title: `Practice: ${article.title}`,
    description: `Work through the ${article.title} system design interview on a whiteboard and get feedback on each step.`,
  };
}

export default function PracticePage(props: PageProps<"/practice/[slug]">) {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <PracticeContent params={props.params} />
    </Suspense>
  );
}

async function PracticeContent({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = getPracticeArticle(slug);
  if (!article) notFound();

  const plan = buildPracticePlan(article);
  if (plan.steps.length === 0) notFound();

  const files = new Set<string>();
  for (const s of plan.steps) collectDiagramFiles(s.sampleBlocks, files);
  const diagrams = await loadDiagrams(article.slug, files);

  return (
    <PracticeClient
      slug={slug}
      title={article.title}
      summary={plan.summary}
      articleHref={hrefFor(article.section, slug)}
      steps={plan.steps.map(toMeta)}
      samples={plan.steps.map((s) => (
        <Blocks key={s.id} blocks={s.sampleBlocks} ctx={{ diagrams }} />
      ))}
      emptySamples={plan.steps.map((s) => s.sampleBlocks.length === 0)}
    />
  );
}
