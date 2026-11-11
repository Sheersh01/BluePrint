import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/shell/SiteHeader";
import { SiteFooter } from "@/components/shell/SiteFooter";
import { navigation, hrefFor } from "@/content/navigation";
import { getArticle } from "@/content/registry";
import { site } from "@/config/site";
import { loadDiagrams } from "@/lib/diagrams";

const BLURB: Record<string, string> = {
  "problem-breakdowns":
    "Worked interview questions, from requirements to the final whiteboard.",
  patterns:
    "The recurring moves behind most designs, and when to reach for each.",
  "deep-dives":
    "The databases, queues and engines you'll name — and what they're actually good at.",
  questions: "Short, interview-length answers to the concept and scenario questions you'll be asked.",
  tips: "Cheat sheets for the room: the game plan, the numbers, and the failure scenarios to have ready.",
  "code-review":
    "You're handed working-looking code and asked what breaks. Find the bugs, explain them, fix them.",
  "real-life":
    "Custom questions from actual interviews, solved — and mapped back to the standard problems they're built from.",
};

/** Home-page index layout: which sections share a column. Any section not listed gets its own column. */
const STACKED = [["problem-breakdowns"], ["patterns", "tips"], ["deep-dives", "real-life"], ["questions", "code-review"]];
const COLUMNS = [
  ...STACKED,
  ...navigation.map((s) => s.section).filter((id) => !STACKED.flat().includes(id)).map((id) => [id]),
];

const qaCount = (section: string, slug: string) =>
  getArticle(section, slug)?.blocks.filter((b) => b.type === "qa").length ?? 0;

/** The Bitly final design, read from disk once and cached into the static page. */
async function HeroFigure() {
  "use cache";
  const { "final-design.svg": figure } = await loadDiagrams("bitly", [
    "final-design.svg",
  ]);
  if (!figure) return null;
  return (
    <figure className="hidden lg:block">
      <div
        className="diagram-svg rotate-[-1.5deg] opacity-90"
        dangerouslySetInnerHTML={{ __html: figure }}
      />
      <figcaption className="mt-4 border-t border-line pt-3 font-serif text-[14px] text-muted italic">
        Fig. 1 — A URL shortener, drawn the way you&apos;d draw it in the room.
      </figcaption>
    </figure>
  );
}

/** One section of the home-page index: heading, blurb and its numbered list. */
function SectionIndex({ id, questions }: { id: string; questions: number }) {
  const si = navigation.findIndex((s) => s.section === id);
  const sec = navigation[si];
  if (!sec) return null;
  return (
    <div>
      <div className="flex items-baseline justify-between border-b border-ink pb-2">
        <h2 className="font-serif text-[26px] font-medium tracking-[-0.02em] text-ink">
          <span className="mr-2 font-mono text-[12px] tracking-normal text-faint">
            {String(si + 1).padStart(2, "0")}
          </span>
          {sec.title}
        </h2>
        <span className="font-mono text-[12px] text-muted">
          {sec.section === "questions" ? questions : sec.items.length}
        </span>
      </div>
      <p className="mt-3 text-[14px] leading-relaxed text-muted">
        {BLURB[sec.section]}
      </p>
      {sec.section === "problem-breakdowns" && (
        <Link href="/tags" className="mt-2 inline-block text-[13px] text-primary hover:underline">
          Browse by domain, topic or pattern →
        </Link>
      )}
      <ol className="mt-4">
        {sec.items.map((item, i) => {
          const a = getArticle(sec.section, item.slug);
          return (
            <li key={item.slug}>
              <Link
                href={hrefFor(sec.section, item.slug)}
                className="group flex items-baseline gap-3 border-b border-line py-2 text-[15px] transition-colors"
              >
                <span className="w-6 shrink-0 font-mono text-[11px] text-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="flex-1 text-ink transition-colors group-hover:text-primary">
                  {item.title}
                </span>
                {sec.section === "questions" && (
                  <span className="font-mono text-[11px] text-faint">{qaCount(sec.section, item.slug)}</span>
                )}
                {a?.difficulty && (
                  <span className="text-[10px] font-semibold tracking-[0.12em] text-faint uppercase">
                    {a.difficulty}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function Home() {
  const writeUps = navigation.filter((s) => s.section !== "questions").reduce((n, s) => n + s.items.length, 0);
  const questions = navigation
    .filter((s) => s.section === "questions")
    .flatMap((s) => s.items.map((i) => qaCount(s.section, i.slug)))
    .reduce((a, b) => a + b, 0);

  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main>
        <section className="mx-auto grid max-w-[1080px] items-center gap-12 px-5 pt-20 pb-16 sm:px-10 sm:pt-28 lg:grid-cols-[1fr_400px]">
          <div>
            <p className="label-caps">A field guide · {writeUps} write-ups · {questions} questions</p>
            <h1 className="mt-5 max-w-[14ch] font-serif text-[52px] leading-[0.98] font-medium tracking-[-0.035em] text-ink sm:text-[76px]">
              Design systems you can defend.
            </h1>
            <p className="mt-6 max-w-[54ch] text-[18px] leading-relaxed text-body">
              {site.description} Every page is written to be read end to end,
              then argued with.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-6 text-[15px]">
              <Link
                href={hrefFor("problem-breakdowns", "bitly")}
                className="inline-flex items-center gap-2 rounded-[4px] bg-ink px-4 py-2.5 font-medium text-bg transition-colors hover:bg-primary"
              >
                Start with Bitly{" "}
                <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
              </Link>
              <Link
                href={hrefFor("patterns", "scaling-reads")}
                className="text-body underline decoration-line-strong underline-offset-4 transition-colors hover:text-primary hover:decoration-primary"
              >
                or begin with the patterns
              </Link>
              <Link
                href="/practice"
                className="text-body underline decoration-line-strong underline-offset-4 transition-colors hover:text-primary hover:decoration-primary"
              >
                or practise on a whiteboard
              </Link>
            </div>
          </div>
          <HeroFigure />
        </section>

        <section className="border-t border-line" aria-label="Library index">
          <div className="mx-auto grid max-w-[1080px] gap-x-12 gap-y-14 px-5 py-16 sm:px-10 md:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr] lg:gap-x-10">
            {COLUMNS.map((col) => (
              // Sections stack in columns so short ones (Patterns, Tips) share a column
              // instead of waiting below the long Problems list.
              <div key={col.join()} className="space-y-14">
                {col.map((id) => (
                  <SectionIndex key={id} id={id} questions={questions} />
                ))}
              </div>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
