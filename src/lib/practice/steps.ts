import type { Article, Block } from "@/content/types";
import { articles, getArticle, stripInline } from "@/content/registry";
import { PRACTICE_SECTIONS, isPracticeSection } from "./sections";

export { PRACTICE_SECTIONS, isPracticeSection };

/** The practisable article for a slug (slugs are unique across sections). */
export function getPracticeArticle(slug: string) {
  for (const section of PRACTICE_SECTIONS) {
    const a = getArticle(section, slug);
    if (a) return a;
  }
  return null;
}

export const practiceArticles = () => articles.filter((a) => isPracticeSection(a.section));

export type StepKind = "functional" | "non-functional" | "entities" | "api" | "hld" | "deep-dive";

/** Where on the whiteboard a step is answered. */
export type FrameId = "fr" | "nfr" | "entities" | "api" | "hld";

/** Serializable step data that is safe to hand to the client. */
export interface StepMeta {
  /** Stable id used for saved answers: fr, nfr, entities, api, hld-1…, dd-1… */
  id: string;
  kind: StepKind;
  /** Short label shown above the question */
  chip: string;
  question: string;
  /** Suggested time for this step, in minutes */
  minutes: number;
  frame: FrameId;
}

export interface PracticeStep extends StepMeta {
  /** The article's own write-up for this step (without its heading). */
  sampleBlocks: Block[];
}

export interface PracticePlan {
  steps: PracticeStep[];
  /** One-paragraph description of the system, for the board and the grader. */
  summary: string;
  /** The "What is expected at each level" section, for the grader. */
  levelBlocks: Block[];
}

type Heading = Extract<Block, { type: "heading" }>;

const isHeading = (b: Block): b is Heading => b.type === "heading";
const clean = (text: string) =>
  stripInline(text)
    .replace(/\\([.()])/g, "$1")
    .replace(/^\s*\d+\s*[.)]\s*/, "")
    .trim();

/** Blocks after heading `i` up to the next heading of the same or a higher level. */
function sectionAt(blocks: Block[], i: number): Block[] {
  const h = blocks[i] as Heading;
  const out: Block[] = [];
  for (let j = i + 1; j < blocks.length; j++) {
    const b = blocks[j];
    if (isHeading(b) && b.level <= h.level) break;
    out.push(b);
  }
  return out;
}

const findHeading = (blocks: Block[], test: (h: Heading) => boolean, from = 0, to = blocks.length) => {
  for (let i = from; i < to; i++) {
    const b = blocks[i];
    if (isHeading(b) && test(b)) return i;
  }
  return -1;
};

/** Index of the next level-2 heading after `i` (or the end). */
const nextH2 = (blocks: Block[], i: number) => {
  const j = findHeading(blocks, (h) => h.level === 2, i + 1);
  return j === -1 ? blocks.length : j;
};

// Content that only makes sense inside the full article.
const SAMPLE_SKIP = new Set<Block["type"]>(["tryIt", "quiz"]);
const forSample = (blocks: Block[]) => blocks.filter((b) => !SAMPLE_SKIP.has(b.type));

const DEEP_DIVE_SKIP = /final design|additional deep dives|tying it all|putting it all|bringing it all/i;

/**
 * Derives a mock-interview flow from a problem breakdown's headings:
 * requirements → core entities → API → one high-level-design step per functional
 * requirement → one step per deep dive. Sections that are missing are simply skipped.
 */
export function buildPracticePlan(article: Article): PracticePlan {
  const blocks = article.blocks;
  const steps: PracticeStep[] = [];

  const add = (i: number, meta: Omit<StepMeta, "id"> & { id: string }) => {
    if (i < 0) return;
    steps.push({ ...meta, sampleBlocks: forSample(sectionAt(blocks, i)) });
  };

  add(findHeading(blocks, (h) => h.id === "functional-requirements" || /^functional requirements/i.test(h.text)), {
    id: "fr",
    kind: "functional",
    chip: "Requirements",
    question: "What are the functional requirements of this system?",
    minutes: 3,
    frame: "fr",
  });
  add(
    findHeading(blocks, (h) => h.id === "non-functional-requirements" || /non-functional requirements/i.test(h.text)),
    {
      id: "nfr",
      kind: "non-functional",
      chip: "Requirements",
      question: "What are the non-functional requirements of this system?",
      minutes: 3,
      frame: "nfr",
    },
  );
  add(findHeading(blocks, (h) => h.level === 3 && /core entities/i.test(h.text)), {
    id: "entities",
    kind: "entities",
    chip: "Core Entities",
    question: "What are the core entities of the system?",
    minutes: 2,
    frame: "entities",
  });
  add(findHeading(blocks, (h) => h.level === 3 && /\bAPI\b|system interface/i.test(h.text)), {
    id: "api",
    kind: "api",
    chip: "API",
    question: "What are the main API endpoints this system will need?",
    minutes: 4,
    frame: "api",
  });

  // High-level design: one step per sub-heading (each is a functional requirement).
  const hld = findHeading(blocks, (h) => h.level === 2 && /high[- ]level design/i.test(h.text));
  if (hld >= 0) {
    const end = nextH2(blocks, hld);
    const subs: number[] = [];
    for (let i = hld + 1; i < end; i++) {
      const b = blocks[i];
      if (isHeading(b) && b.level === 3 && !DEEP_DIVE_SKIP.test(b.text)) subs.push(i);
    }
    if (subs.length === 0) {
      add(hld, {
        id: "hld-1",
        kind: "hld",
        chip: "High-Level Design",
        question: "Sketch a high-level design that satisfies the functional requirements.",
        minutes: 8,
        frame: "hld",
      });
    } else {
      subs.forEach((i, n) => {
        const req = clean((blocks[i] as Heading).text).replace(/[.]$/, "");
        add(i, {
          id: `hld-${n + 1}`,
          kind: "hld",
          chip: "High-Level Design",
          question: `How will your design support this requirement: “${req}”?`,
          minutes: 6,
          frame: "hld",
        });
      });
    }
  }

  // Deep dives: one step per numbered sub-heading.
  const dd = findHeading(blocks, (h) => h.level === 2 && /deep dives/i.test(h.text));
  if (dd >= 0) {
    const end = nextH2(blocks, dd);
    let n = 0;
    for (let i = dd + 1; i < end; i++) {
      const b = blocks[i];
      if (!isHeading(b) || b.level !== 3 || DEEP_DIVE_SKIP.test(b.text)) continue;
      n++;
      add(i, {
        id: `dd-${n}`,
        kind: "deep-dive",
        chip: "Deep Dive",
        question: clean(b.text),
        minutes: 5,
        frame: "hld",
      });
    }
  }

  const lvl = findHeading(blocks, (h) => h.level === 2 && /expected at each level/i.test(h.text));
  const levelBlocks = lvl >= 0 ? blocks.slice(lvl + 1, nextH2(blocks, lvl)) : [];

  const definition = blocks.find((b) => b.type === "definition");
  const summary = stripInline(definition && definition.type === "definition" ? definition.text : article.description);

  return { steps, summary, levelBlocks };
}

export const toMeta = ({ id, kind, chip, question, minutes, frame }: PracticeStep): StepMeta => ({
  id,
  kind,
  chip,
  question,
  minutes,
  frame,
});
