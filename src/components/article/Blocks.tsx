import type { Block, ListItem, QuizQuestion } from "@/content/types";
import { Inline } from "@/lib/inline";
import { Callout } from "./Callout";
import { CodeBlock } from "./CodeBlock";
import { Diagram } from "./Diagram";
import { SolutionCard } from "./SolutionCard";
import { TryItCard } from "./TryItCard";
import { PatternCard } from "./PatternCard";
import { Quiz } from "./Quiz";
import { QACard } from "./QACard";

export interface BlockContext {
  diagrams: Record<string, string>;
  quiz?: QuizQuestion[];
  /** faint sketch used behind the "Try it yourself" card */
  backdrop?: string;
}

export function Blocks({ blocks, ctx }: { blocks: Block[]; ctx: BlockContext }) {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} ctx={ctx} />
      ))}
    </>
  );
}

function List({ items, ordered, start }: { items: ListItem[]; ordered?: boolean; start?: number }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag start={start} className="hi-list">
      {items.map((it, i) =>
        typeof it === "string" ? (
          <li key={i}>
            <Inline text={it} />
          </li>
        ) : (
          <li key={i}>
            <Inline text={it.text} />
            {it.children && <List items={it.children} ordered={it.ordered} />}
          </li>
        ),
      )}
    </Tag>
  );
}

function BlockView({ block: b, ctx }: { block: Block; ctx: BlockContext }) {
  switch (b.type) {
    case "heading": {
      // Headings never link out — the reading column stays self-contained.
      const common = {
        id: b.id,
        "data-anchor": "",
        "data-label": b.tocLabel ?? undefined,
      };
      if (b.level === 2) {
        return (
          <h2
            {...common}
            className="mt-16 mb-5 border-t border-line pt-8 font-serif text-[30px] leading-[1.15] font-medium tracking-[-0.02em] text-ink first:mt-4 first:border-0 first:pt-0 sm:text-[34px]"
          >
            <Inline text={b.text} />
          </h2>
        );
      }
      return (
        <h3 {...common} className="mt-10 mb-4 text-[19px] leading-snug font-semibold tracking-[-0.01em] text-ink sm:text-[20px]">
          <Inline text={b.text} />
        </h3>
      );
    }
    case "paragraph":
      return (
        <p className="hi-p">
          <Inline text={b.text} />
        </p>
      );
    case "label":
      return (
        <p className="label-caps mt-6 mb-2 text-ink!">
          <Inline text={b.text} />
        </p>
      );
    case "list":
      return <List items={b.items} ordered={b.ordered} start={b.start} />;
    case "callout":
      return (
        <Callout variant={b.variant} title={b.title}>
          <Blocks blocks={b.blocks} ctx={ctx} />
        </Callout>
      );
    case "definition":
      return (
        <div className="my-8 border-y border-line py-5">
          <p className="font-serif text-[21px] font-medium text-ink">
            <Inline text={b.title} />
          </p>
          <p className="mt-1.5 text-[17px] leading-[1.7] text-body">
            <Inline text={b.text} />
          </p>
        </div>
      );
    case "tryIt":
      return <TryItCard eyebrow={b.eyebrow} question={b.question} answerTarget={b.answerTarget} backdrop={ctx.backdrop} />;
    case "code":
      return <CodeBlock code={b.code} title={b.title} />;
    case "diagram":
      return <Diagram svg={ctx.diagrams[b.file] ?? ""} caption={b.caption} maxWidth={b.maxWidth} />;
    case "solution":
      return (
        <SolutionCard verdict={b.verdict} title={b.title}>
          <p className="label-caps mb-3">Approach</p>
          <Blocks blocks={b.approach} ctx={ctx} />
          {b.challenges.length > 0 && (
            <>
              <p className="label-caps mt-7 mb-3">Trade-offs</p>
              <Blocks blocks={b.challenges} ctx={ctx} />
            </>
          )}
        </SolutionCard>
      );
    case "pattern":
      return <PatternCard title={b.title} text={b.text} href={b.href} />;
    case "sketch":
      return (
        <figure className="my-8">
          <div className="mx-auto w-fit rounded-[5px] border border-dashed border-line-strong px-7 py-5">
            <pre className="font-hand text-[17px] leading-[1.45] whitespace-pre-wrap text-ink">{b.lines.join("\n")}</pre>
          </div>
          <figcaption className="mt-3 text-center font-serif text-[14px] text-muted italic">{b.caption}</figcaption>
        </figure>
      );
    case "table":
      return (
        <div className="thin-scroll my-7 overflow-x-auto border-y border-line-strong">
          <table className="w-full text-left text-[14px]">
            <thead className="border-b border-line text-ink">
              <tr>
                {b.rows[0]?.map((c, i) => (
                  <th key={i} className="px-4 py-2.5 align-bottom font-semibold">
                    <Inline text={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.slice(1).map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {r.map((c, j) => (
                    <td key={j} className="px-4 py-2 align-top text-[14px] leading-snug text-body">
                      <Inline text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "qa":
      return (
        <QACard id={b.id} number={b.number} qtype={b.qtype} level={b.level} question={b.question}>
          <Blocks blocks={b.blocks} ctx={ctx} />
        </QACard>
      );
    case "quiz":
      return ctx.quiz?.length ? <Quiz questions={ctx.quiz} /> : null;
  }
}
