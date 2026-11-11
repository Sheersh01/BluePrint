/**
 * Content model for articles.
 *
 * Inline text fields (`text`, list items, etc.) support a tiny markdown dialect:
 *   **bold**   *italic*   `code`   [label](url)   __underline__   {{ABBR|Full meaning}}
 */

export type ListItem = string | { text: string; children?: ListItem[]; ordered?: boolean };

export type Block =
  | {
      type: "heading";
      level: 2 | 3;
      id: string;
      text: string;
      /** Headings that link to a framework/concept page are rendered underlined. */
      href?: string;
      /** Shorter label for the "On This Page" table of contents. */
      tocLabel?: string;
      /** Set false to hide from the table of contents. */
      toc?: boolean;
    }
  | { type: "paragraph"; text: string }
  | { type: "label"; text: string }
  | { type: "list"; ordered?: boolean; start?: number; items: ListItem[] }
  | { type: "callout"; variant: "tip" | "info" | "warning"; blocks: Block[]; /** Overrides the default label */ title?: string }
  | { type: "definition"; emoji?: string; title: string; text: string }
  | { type: "tryIt"; eyebrow: string; question: string; answerTarget?: string }
  | { type: "code"; code: string; title?: string }
  | { type: "diagram"; file: string; caption: string; maxWidth?: number }
  | {
      type: "solution";
      verdict: "bad" | "good" | "great";
      title: string;
      approach: Block[];
      challenges: Block[];
    }
  | { type: "pattern"; title: string; text: string; href: string }
  /** One question from the Questions bank, with its answer */
  | {
      type: "qa";
      number: number;
      qtype: "Define" | "Compare" | "How" | "Decide" | "Scenario" | "Design";
      level: "B" | "I" | "A";
      question: string;
      id: string;
      blocks: Block[];
    }
  /** Hand-written whiteboard notes (rendered in the sketch font) */
  | { type: "sketch"; lines: string[]; caption: string }
  | { type: "table"; rows: string[][] }
  | { type: "quiz" };

export interface QuizQuestion {
  question: string;
  options: string[];
  /** zero-based index of the correct option */
  answer: number;
  explanation: string;
  /** heading id to jump to when the learner gets it wrong */
  section?: string;
}

export interface Article {
  section: string;
  slug: string;
  /** Eyebrow shown above the title, e.g. "Common Problems" */
  category: string;
  title: string;
  /** One-line summary shown under the title (guides) */
  subtitle?: string;
  seoTitle: string;
  description: string;
  tags: { label: string; href: string }[];
  author: string;
  published: string;
  updated: string;
  /** "Updated" (default) or "Published" */
  updatedLabel?: "Updated" | "Published";
  difficulty?: "easy" | "medium" | "hard";
  askedAt?: { companies: string[]; more: number };
  video?: { title: string; subtitle: string; url?: string };
  blocks: Block[];
  quiz?: QuizQuestion[];
}

export interface TocItem {
  id: string;
  label: string;
  children: { id: string; label: string }[];
  /** A question listed at the top level (Q&A page without sub-headings) */
  qaOnly?: boolean;
}
