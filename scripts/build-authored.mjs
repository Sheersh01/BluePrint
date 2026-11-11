#!/usr/bin/env node
/**
 * Builds an Article JSON (+ diagram SVGs) from an authored markdown file.
 *
 *   node scripts/build-authored.mjs content-src/authored/<slug>.md
 *
 * Format — frontmatter, then a markdown subset:
 *   ---
 *   title: Yelp
 *   tags: Scaling Reads, Geospatial
 *   difficulty: medium
 *   author: Editorial Team
 *   published: Nov 4, 2026
 *   askedAt: Google, Amazon | 12          (companies | extra count)
 *   description: one sentence for SEO
 *   ---
 *   ## Heading / ### Sub-heading         (standard framework headings link to the Delivery Framework)
 *   **Label**                             (bold line on its own)
 *   1. / - lists (indent 2+ spaces to nest)
 *   ```lang ... ```                       code
 *   ```diagram Caption ... ```            hand-drawn diagram (see scripts/lib/sketch.mjs)
 *   ```sketch Caption ... ```             whiteboard notes
 *   ```quiz [ ...JSON questions... ] ```  quiz (rendered at the end)
 *   :::tip / :::info / :::warning … :::   callouts (optional label: `:::info Interviewer asks`)
 *   :::definition 🔗 What is X? … :::
 *   :::tryit First Question … :::         (body = the question; answer target = next heading)
 *   :::pattern Pattern: Name … :::
 *   :::solution bad|good|great Title … #### Approach … #### Challenges … :::
 */
import fs from "node:fs";
import path from "node:path";
import { renderSketch } from "./lib/sketch.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/build-authored.mjs <file.md>");
  process.exit(1);
}
const slug = path.basename(file, ".md");
const src = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

const fm = src.match(/^---\n([\s\S]*?)\n---\n/);
if (!fm) throw new Error(`${file}: missing frontmatter`);
const meta = Object.fromEntries(
  fm[1].split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf(":");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const lines = src.slice(fm[0].length).split("\n");

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[`*]/g, "")
    .replace(/\+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const diagramDir = path.join(ROOT, "src", "content", "diagrams", slug);
fs.rmSync(diagramDir, { recursive: true, force: true });
fs.mkdirSync(diagramDir, { recursive: true });
let diagramCount = 0;
let quiz = [];
const pendingTryIts = [];

/** Parses lines[i..] until a closing ":::" (when nested) or EOF. Returns [blocks, nextIndex]. */
function parseBlocks(i, nested) {
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "paragraph", text: para.join(" ").trim() });
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    if (nested && t === ":::") {
      flush();
      return [blocks, i + 1];
    }
    if (!t) {
      flush();
      i++;
      continue;
    }

    // fenced blocks
    const fence = t.match(/^```(\w*)\s*(.*)$/);
    if (fence) {
      flush();
      const body = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "```") body.push(lines[i++]);
      i++;
      const kind = fence[1];
      if (kind === "diagram") {
        const caption = fence[2] || "Diagram";
        const name = `${String(++diagramCount).padStart(2, "0")}-${slugify(caption).slice(0, 40)}.svg`;
        fs.writeFileSync(path.join(diagramDir, name), renderSketch(body.join("\n"), `${slug}-${name}`));
        blocks.push({ type: "diagram", file: name, caption });
      } else if (kind === "sketch") {
        blocks.push({ type: "sketch", lines: body, caption: fence[2] || "Whiteboard" });
      } else if (kind === "quiz") {
        quiz = JSON.parse(body.join("\n"));
      } else {
        blocks.push({ type: "code", code: body.join("\n") });
      }
      continue;
    }

    // containers
    const cont = t.match(/^:::(\w+)\s*(.*)$/);
    if (cont) {
      flush();
      const [, kind, arg] = cont;
      const [inner, next] = parseBlocks(i + 1, true);
      i = next;
      const innerText = () => inner.filter((b) => b.type === "paragraph").map((b) => b.text).join(" ");
      if (kind === "tip" || kind === "info" || kind === "warning")
        blocks.push({ type: "callout", variant: kind, blocks: inner, ...(arg ? { title: arg } : {}) });
      else if (kind === "definition") {
        const m = arg.match(/^(\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*)\s*(.*)$/u);
        blocks.push({ type: "definition", emoji: m?.[1], title: m ? m[2] : arg, text: innerText() });
      } else if (kind === "tryit") {
        const b = { type: "tryIt", eyebrow: arg || "First Question", question: innerText() };
        pendingTryIts.push(b);
        blocks.push(b);
      } else if (kind === "pattern") {
        const name = arg.replace(/^Pattern:\s*/, "");
        blocks.push({ type: "pattern", title: arg, text: innerText(), href: `/learn/system-design/patterns/${slugify(name)}` });
      } else if (kind === "solution") {
        const m = arg.match(/^(bad|good|great)\s+(.*)$/);
        if (!m) throw new Error(`${file}: bad solution header "${arg}"`);
        const approach = [];
        const challenges = [];
        let part = approach;
        for (const b of inner) {
          if (b.type === "heading4") part = /challenge/i.test(b.text) ? challenges : approach;
          else part.push(b);
        }
        blocks.push({ type: "solution", verdict: m[1], title: m[2], approach, challenges });
      } else if (kind === "qa") {
        // :::qa 14 | Define | B | What is the CAP theorem?
        const m = arg.match(/^(\d+)\s*\|\s*(Define|Compare|How|Decide|Scenario|Design)\s*\|\s*([BIA])\s*\|\s*(.+)$/);
        if (!m) throw new Error(`${file}: bad qa header "${arg}"`);
        blocks.push({ type: "qa", number: Number(m[1]), qtype: m[2], level: m[3], question: m[4].trim(), id: `q-${m[1]}`, blocks: inner });
      } else throw new Error(`${file}: unknown container :::${kind}`);
      continue;
    }

    // headings
    const h = t.match(/^(#{2,4})\s+(.*)$/);
    if (h) {
      flush();
      const text = h[2].trim();
      if (h[1].length === 4) blocks.push({ type: "heading4", text });
      else {
        const b = { type: "heading", level: h[1].length, id: slugify(text), text };
        for (const p of pendingTryIts.splice(0)) p.answerTarget = b.id;
        blocks.push(b);
      }
      i++;
      continue;
    }

    // horizontal rule: section breaks are already given by headings
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      flush();
      i++;
      continue;
    }

    // markdown table: | a | b |, with an optional |---|---| separator after the header row
    if (t.startsWith("|") && !para.length) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const row = lines[i].trim();
        i++;
        if (/^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-*:?\s*$/.test(row)) continue;
        const cells = row
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split(/(?<!\\)\|/)
          .map((c) => c.trim().replace(/\\\|/g, "|"));
        rows.push(cells);
      }
      blocks.push({ type: "table", rows });
      continue;
    }

    // blockquote → tip callout
    if (t.startsWith(">")) {
      flush();
      const body = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) body.push(lines[i++].trim().replace(/^>\s?/, ""));
      blocks.push({ type: "callout", variant: "tip", blocks: [{ type: "paragraph", text: body.join(" ").trim() }] });
      continue;
    }

    // bold label
    const label = t.match(/^\*\*([^*]+)\*\*$/);
    if (label) {
      flush();
      blocks.push({ type: "label", text: label[1] });
      i++;
      continue;
    }

    // lists
    if (/^(\d+\.|-)\s+/.test(t) && !para.length) {
      const ordered = /^\d+\./.test(t);
      const start = ordered ? parseInt(t, 10) : undefined;
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        const m = l.match(/^(\s*)(\d+\.|-)\s+(.*)$/);
        if (!m) {
          // continuation line of the previous item
          if (l.trim() && /^\s{2,}\S/.test(l) && items.length) {
            const last = items[items.length - 1];
            if (typeof last === "string") items[items.length - 1] = `${last} ${l.trim()}`;
            else last.text += ` ${l.trim()}`;
            i++;
            continue;
          }
          break;
        }
        if (m[1].length >= 2 && items.length) {
          const last = items[items.length - 1];
          const obj = typeof last === "string" ? { text: last, children: [] } : last;
          obj.children.push(m[3]);
          if (/^\d/.test(m[2])) obj.ordered = true;
          items[items.length - 1] = obj;
        } else items.push(m[3]);
        i++;
      }
      const b = { type: "list", ordered, items };
      if (start && start !== 1) b.start = start;
      blocks.push(b);
      continue;
    }

    para.push(t);
    i++;
  }
  flush();
  if (nested) throw new Error(`${file}: unclosed ::: container`);
  return [blocks, i];
}

const [blocks] = parseBlocks(0, false);
if (blocks.some((b) => b.type === "heading4")) throw new Error(`${file}: #### is only allowed inside :::solution`);
if (quiz.length) blocks.push({ type: "quiz" });

const [companiesPart, morePart] = (meta.askedAt ?? "").split("|").map((s) => s?.trim());
const companies = companiesPart ? companiesPart.split(",").map((s) => s.trim()).filter(Boolean) : [];
const article = {
  section: meta.section ?? "problem-breakdowns",
  slug,
  category: meta.category ?? "Common Problems",
  title: meta.title,
  subtitle: meta.subtitle,
  seoTitle: meta.seoTitle ?? `Design ${meta.title} | System Design Interview Breakdown`,
  description: meta.description ?? meta.subtitle ?? `How to design ${meta.title} in a system design interview.`,
  tags: (meta.tags ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ label, href: `/learn/system-design/patterns/${slugify(label)}` })),
  author: meta.author ?? "Editorial Team",
  published: meta.published ?? meta.updated,
  updated: meta.updated ?? meta.published,
  updatedLabel: meta.updated ? "Updated" : "Published",
  difficulty: meta.difficulty,
  askedAt: companies.length || morePart ? { companies, more: parseInt(morePart ?? "0", 10) || 0 } : undefined,
  blocks,
  quiz,
};

const out = path.join(ROOT, "src", "content", "problems", `${slug}.json`);
fs.writeFileSync(out, JSON.stringify(article, null, 2) + "\n");
const count = (bs, t) => bs.reduce((n, b) => n + (b.type === t) + (b.type === "solution" ? count(b.approach, t) + count(b.challenges, t) : 0), 0);
console.log(
  `${slug}: ${blocks.length} blocks, ${count(blocks, "solution")} solutions, ${diagramCount} diagrams, ${quiz.length} quiz questions (authored)`,
);
