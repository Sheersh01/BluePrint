#!/usr/bin/env node
/**
 * Converts a scraped problem breakdown into an Article JSON file + diagram SVGs.
 *
 * Usage:
 *   node scripts/import-problem.mjs <raw-file> <slug> [--report]
 *
 * The raw file has two halves:
 *   1. a plain-text page dump (complete text, incl. solution cards, but no formatting)
 *   2. a markdown scrape starting at "**Title:**" (formatting + Excalidraw SVGs, but no solution cards)
 * The plain text drives the order of content; the markdown supplies formatting and diagrams.
 * Per-problem extras (solution titles, quiz, callouts) live in content-src/overrides/<slug>.json.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const [src, slug, ...flags] = process.argv.slice(2);
if (!src || !slug) {
  console.error("usage: node scripts/import-problem.mjs <raw-file> <slug> [--report]");
  process.exit(1);
}
const REPORT = flags.includes("--report");

const raw = fs.readFileSync(src, "utf8").replace(/\r\n/g, "\n");
const titleAt = raw.search(/^\*\*Title:\*\*/m);
if (titleAt < 0) throw new Error("markdown half (**Title:**) not found");
const plain = raw.slice(0, titleAt).split("\n").map((l) => l.replace(/\s+$/, ""));
const md = raw.slice(titleAt).split("\n").map((l) => l.replace(/\s+$/, ""));

const overridesPath = path.join(ROOT, "content-src", "overrides", `${slug}.json`);
const overrides = fs.existsSync(overridesPath) ? JSON.parse(fs.readFileSync(overridesPath, "utf8")) : {};

/* ----------------------------------------------------------------- helpers */
const norm = (s) =>
  s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\([*_`#\[\]()>|.!-])/g, "$1")
    .replace(/[*`]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** markdown inline → our inline dialect */
const inline = (s) =>
  s
    .replace(/\[([^\]]*)\]\(https?:\/\/(?:www\.)?hellointerview\.com(\/[^)]*)\)/g, "[$1]($2)")
    .replace(/\\([*_`#\[\]()>|.!-])/g, "$1")
    .trim();

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/\+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const isCodeLine = (l) =>
  /^\s{2,}\S/.test(l) ||
  /^[{}\[\]]/.test(l) ||
  /[{};]\s*$/.test(l) ||
  /"\s*:/.test(l) ||
  /\s->\s|^->/.test(l) ||
  /^\s*(GET|POST|PUT|PATCH|DELETE|HTTP\/|SELECT|INSERT|UPDATE|CREATE|FROM|WHERE|BEGIN|COMMIT|ZADD|ZINCRBY|ZRANGE|SET|GET|INCR|EXPIRE|MULTI|EXEC|HSET|HGET|def |function |const |let |var |return |if \(|for \(|while |class |import |#|\/\/)/.test(l) ||
  /^\w[\w.]*\s*=\s*\S/.test(l) ||
  /^\|.*\|$/.test(l) ||
  /^\w[\w-]*:\s*[\[{"]/.test(l) ||
  /^(Request|Response|Body|Headers|Request body|Response body):$/i.test(l.trim());

/* ------------------------------------------------------- parse markdown half */
const meta = {};
for (const l of md.slice(0, 12)) {
  const m = l.match(/^\*\*(Title|Author|Date|Source):\*\*\s*(.*)$/);
  if (m) meta[m[1].toLowerCase()] = m[2];
}

const mdIndex = new Map(); // normalized text -> info[] (occurrences in markdown order)
const mdAdd = (key, info) => {
  if (!mdIndex.has(key)) mdIndex.set(key, []);
  mdIndex.get(key).push(info);
};
const mdHas = (key) => (mdIndex.get(key)?.length ?? 0) > 0;
const mdTake = (key) => mdIndex.get(key)?.shift();
const mdPeek = (key) => mdIndex.get(key)?.[0];
let quizSeed = null;
/*
 * SVGs from the markdown half. Several diagrams can share a caption, so each caption holds a queue.
 * Diagrams without a caption are keyed by the markdown block that follows them (svgBefore).
 */
const svgEntries = []; // { caption, svg, used }
const svgQueue = new Map(); // normalized caption -> entries
const svgBefore = new Map(); // normalized key of following block -> entry
const svgByCaption = {
  has: (k) => (svgQueue.get(k) ?? []).some((e) => !e.used),
  get: (k) => (svgQueue.get(k) ?? []).find((e) => !e.used),
};
const mdKey = (line) => {
  const h = line.match(/^#{2,6}\s+(.*)$/);
  if (h) return norm(h[1]);
  const li = line.match(/^\s*(\d+\.|[-*])\s+(.*)$/);
  return norm(li ? li[2] : line);
};
const mdHeadings = []; // {level, text}
const codeFences = []; // {lines}
let listId = 0;
let lastWasList = false;
let fence = null;
let pendingSvg = null;
let lastTopItemKey = null;

for (let i = 0; i < md.length; i++) {
  const line = md[i];
  // Everything after the quiz is the "On This Page" echo — ignore it, but capture the first quiz question.
  if (/^#{2,6}\s+Test Your Knowledge/.test(line)) {
    const rest = md.slice(i + 1).map((l) => l.trim()).filter(Boolean);
    const qAt = rest.findIndex((l) => /^Question 1 of/.test(l));
    if (qAt >= 0) {
      const question = rest[qAt + 1];
      const options = [];
      for (let k = qAt + 2; k + 1 < rest.length && /^\d+$/.test(rest[k]); k += 2) options.push(rest[k + 1]);
      quizSeed = { question, options };
    }
    break;
  }
  if (fence) {
    if (/^```/.test(line)) {
      codeFences.push(fence);
      fence = null;
    } else fence.lines.push(line);
    continue;
  }
  if (/^```/.test(line)) {
    fence = { lines: [] };
    lastWasList = false;
    continue;
  }
  if (!line.trim()) continue;
  if (line.startsWith("**Up to") || /^\*\*(Title|Author|Date|Source):/.test(line) || line === "---") continue;
  if (line.startsWith("<svg")) {
    pendingSvg = line;
    continue;
  }
  if (pendingSvg) {
    const t = line.trim();
    const captionLike = !/^#/.test(t) && !/^(\d+\.|[-*])\s/.test(t) && !line.startsWith("<svg") && t.length <= 90 && !(t.length > 60 && /[.!?]$/.test(t));
    if (captionLike) {
      const entry = { caption: t, svg: pendingSvg, used: false };
      svgEntries.push(entry);
      if (!svgQueue.has(norm(t))) svgQueue.set(norm(t), []);
      svgQueue.get(norm(t)).push(entry);
      pendingSvg = null;
      continue;
    }
    // No caption: anchor the diagram to the block that follows it, and process that line normally.
    const entry = { caption: "", svg: pendingSvg, used: false };
    svgEntries.push(entry);
    svgBefore.set(mdKey(line), entry);
    pendingSvg = null;
  }
  const h = line.match(/^(#{2,6})\s+(.*)$/);
  if (h) {
    mdHeadings.push({ level: h[1].length, text: h[2].trim() });
    mdAdd(norm(h[2]), { kind: "heading", level: h[1].length, text: h[2].trim() });
    lastWasList = false;
    continue;
  }
  const li = line.match(/^(\t*|\s*)(\d+\.|[-*])\s+(.*)$/);
  if (li) {
    const nested = li[1].length > 0;
    if (!lastWasList) listId++;
    lastWasList = true;
    const key = norm(li[3]);
    const info = {
      kind: "li",
      list: listId,
      ordered: /\d/.test(li[2]),
      start: /\d/.test(li[2]) ? parseInt(li[2], 10) : undefined,
      nested,
      parent: nested ? lastTopItemKey : null,
      text: inline(li[3]),
    };
    if (!nested) lastTopItemKey = key;
    mdAdd(key, info);
    continue;
  }
  lastWasList = false;
  const bold = line.match(/^\*\*([^*]+)\*\*\s*$/);
  if (/^(First Question|Try it yourself first|We recommend you to practice|Learn This Pattern|Question \d+ of)/.test(line.trim())) continue;
  mdAdd(norm(line), bold ? { kind: "label", text: bold[1].trim() } : { kind: "p", text: inline(line) });
}

const headingSet = new Map(mdHeadings.filter((h) => h.level <= 3).map((h) => [norm(h.text), h]));

/* ------------------------------------------------------- header metadata */
/*
 * Two header layouts:
 *   problem breakdowns:  Title / tags… / By / author / · / Updated / date / · / difficulty / Asked at: …
 *   deep dives & patterns: "Key Technologies" | "Patterns" / Title / subtitle / [Updated / date] / Watch Video…
 */
const firstLines = plain.map((l) => l.trim()).filter(Boolean);
const GUIDE_KIND = { "Key Technologies": "deep-dives", Patterns: "patterns" }[firstLines[0]];
let bodyStart;
let title;
let subtitle;
let tags = [];
let author;
if (GUIDE_KIND) {
  title = firstLines[1];
  subtitle = firstLines[2];
  const watch = plain.findIndex((l, k) => k < 15 && /^Watch the author/.test(l.trim()));
  if (watch >= 0) bodyStart = watch + 1;
  else {
    const subAt = plain.findIndex((l) => l.trim() === subtitle);
    bodyStart = subAt + 1;
    while (/^(Updated|Published|[A-Z][a-z]{2} \d{1,2}, \d{4})?$/.test(plain[bodyStart]?.trim() ?? "x") && bodyStart < 12) bodyStart++;
  }
  author = meta.author;
} else {
  const firstH2 = mdHeadings.find((h) => h.level === 2)?.text ?? "Understanding the Problem";
  bodyStart = plain.findIndex((l) => norm(l) === norm(firstH2));
}
const head = plain.slice(0, bodyStart).map((l) => l.trim()).filter(Boolean);
if (!GUIDE_KIND) {
  title = head[0];
  const byAt = head.indexOf("By");
  tags = head.slice(1, byAt).map((label) => ({ label, href: `/learn/system-design/patterns/${slugify(label)}` }));
  author = head[byAt + 1];
}
const updatedLabel = head.includes("Updated") ? "Updated" : "Published";
const updated = head.includes(updatedLabel) ? head[head.indexOf(updatedLabel) + 1] : undefined;
const difficulty = head.find((l) => /^(easy|medium|hard)$/.test(l));
const askedIdx = head.indexOf("Asked at:");
const companies = [];
let more = 0;
if (askedIdx >= 0) {
  for (const l of head.slice(askedIdx + 1)) {
    if (/^\+\d+$/.test(l)) {
      more = parseInt(l.slice(1), 10);
      break;
    }
    if (/^Watch Video/.test(l)) break;
    companies.push(l);
  }
}

let published = updated;
if (meta.date) {
  const [m, d, y] = meta.date.split("/").map(Number);
  published = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/* ------------------------------------------------------- walk plain body */
const lines = plain.slice(bodyStart);
const blocks = [];
const report = { diagrams: 0, sketches: 0, droppedDiagrams: [], solutions: [], unmatched: 0 };
const diagramFiles = [];

let solution = null; // current solution block being filled
let solutionPart = null; // "approach" | "challenges"
const target = () => (solution ? solution[solutionPart] : blocks);

let listBlock = null; // currently open list block (for md-matched items)
const closeList = () => (listBlock = null);

function pushBlock(b) {
  if (b.type !== "list") closeList();
  target().push(b);
}

function endSolution() {
  if (solution) {
    blocks.push(solution);
    solution = null;
    solutionPart = null;
  }
  closeList();
}

function emitEntry(entry) {
  entry.used = true;
  const file = `${String(diagramFiles.length + 1).padStart(2, "0")}-${slugify(entry.caption).slice(0, 40) || "diagram"}.svg`;
  diagramFiles.push({ file, svg: entry.svg });
  pushBlock({ type: "diagram", file, caption: entry.caption });
  report.diagrams++;
}

function emitDiagram(caption, run) {
  const entry = svgByCaption.get(norm(caption));
  if (entry) {
    retroClean(""); // leftover labels of this diagram that were emitted before the run was recognised
    emitEntry(entry);
    return;
  }
  // Whiteboard notes (requirements / entities lists) can be shown as a hand-written sketch.
  if (/requirement|entit|whiteboard/i.test(caption) && run.length) {
    pushBlock({ type: "sketch", lines: run, caption: caption.trim(), _u: true });
    report.sketches++;
    return;
  }
  report.droppedDiagrams.push(caption.trim());
}

/* Diagram text that slipped through as blocks is removed retroactively once its caption / a boundary is seen. */
const lineCount = (b) => (b.type === "code" ? b.code.split("\n").length : b.type === "list" ? b.items.length : b.type === "sketch" ? b.lines.length : 1);
const diagramish = (b) =>
  b._u &&
  (b.type === "sketch" ||
    (b.type === "paragraph" && (b.text.length <= 25 || (b.text.length <= 70 && (!/[.!?:]$/.test(b.text) || /\.\.+$/.test(b.text))))) ||
    (b.type === "code" && b.code.split("\n").length <= 4 && b.code.split("\n").every((l) => l.length <= 110)) ||
    (b.type === "list" && b.items.every((x) => typeof x === "string" && x.length <= 70)));
const textOf = (b) => b.text ?? b.code ?? b.caption ?? (b.items ? String(b.items.at(-1)) : "");

function retroClean(svgCaption) {
  const list = target();
  let k = list.length;
  let labels = 0;
  let count = 0;
  while (k > 0 && diagramish(list[k - 1])) {
    if (list[k - 1].type !== "code") labels++;
    count += lineCount(list[k - 1]);
    k--;
  }
  if (svgCaption !== undefined) {
    list.splice(k);
    closeList();
    return count;
  }
  if (count >= 3 && labels >= 2) {
    const popped = list.slice(k);
    const caption = textOf(popped[popped.length - 1]);
    if (/requirement|entit|whiteboard/i.test(caption)) {
      const sk = popped.slice(0, -1).flatMap((b) => (b.type === "sketch" ? b.lines : b.type === "list" ? b.items : b.type === "code" ? b.code.split("\n") : [textOf(b)]));
      list.splice(k);
      closeList();
      list.push({ type: "sketch", lines: sk, caption, _u: true });
      report.sketches++;
      return count;
    }
    report.droppedDiagrams.push(caption.slice(0, 60));
    list.splice(k);
    closeList();
    return count;
  }
  return 0;
}

/** Lines in a diagram are short labels without sentence punctuation. */
const looksLikeLabel = (l) => l.length <= 60 && !/[.?!:;,]$/.test(l.trim()) && !isCodeLine(l);
const looksLikeLabelLoose = (l) => {
  const t = l.trim();
  if (/^-?\s*\.{2,}$/.test(t) || /\.{3,}$/.test(t)) return true; // "...", "- ...."
  if (/^\w+\([^)]*\)$/.test(t)) return true; // "view(eventId)"
  if (t.length <= 25 && !/^(Approach|Challenges)$/.test(t)) return true; // "v.", "Goal Arg.", "81st minute"
  return (t.length <= 60 && !/[.?!]$/.test(t)) || (isCodeLine(t) && t.length <= 110 && !/[.]$/.test(t));
};

let headingPtr = 0;
// Guides repeat their title as the first "## Title" heading — that's the page title, not a section.
const pendingHeadings = mdHeadings.filter((h) => h.level <= 3 && !(GUIDE_KIND && norm(h.text) === norm(title)));

let i = 0;
const peek = (k = 0) => lines[i + k] ?? "";

while (i < lines.length) {
  const line = lines[i];
  const t = line.trim();
  const n = norm(t);

  if (/^(Test Your Knowledge|Reading Progress)$/.test(t)) break;
  if (!t || t === "Show More" || t === "Learn This Pattern") {
    i++;
    continue;
  }

  const nextH = pendingHeadings[headingPtr];

  // ---- An uncaptioned SVG anchored to this block: drop the diagram's loose labels and emit it first.
  const anchored = svgBefore.get(n);
  if (anchored && !anchored.used) {
    retroClean("");
    if ((nextH && n === norm(nextH.text)) || (solution && mdHas(n) && solution[solutionPart].length)) endSolution();
    emitEntry(anchored);
  }

  // ---- Headings (follow the order of markdown headings so captions never match)
  if (nextH && n === norm(nextH.text)) {
    retroClean();
    endSolution();
    headingPtr++;
    const isPattern = false;
    if (!isPattern) {
      const id = slugify(nextH.text);
      const h = { type: "heading", level: nextH.level === 2 ? 2 : 3, id, text: nextH.text };
      const href = overrides.headingLinks?.[nextH.text];
      if (href) h.href = href;
      blocks.push(h);
    }
    i++;
    continue;
  }

  // ---- Caption of a known SVG: everything diagram-like just before it was the diagram's text
  {
    if (svgByCaption.has(n)) {
      const list = target();
      const trailing = list.length && diagramish(list[list.length - 1]);
      const prevLabel = i > 0 && looksLikeLabelLoose(lines[i - 1] ?? "") && !mdHas(norm(lines[i - 1] ?? ""));
      if (trailing || prevLabel) {
        retroClean(t);
        emitDiagram(t, []);
        i++;
        if (norm(lines[i] ?? "") === n) i++;
        continue;
      }
    }
  }

  // ---- Definition box ("🔗 What is X?")
  if (/what is/i.test(t) && /^[^\w\s]/u.test(t) && t.length < 80) {
    const m = t.match(/^(\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*)\s*(.*)$/u);
    endSolution();
    blocks.push({ type: "definition", emoji: m ? m[1] : undefined, title: m ? m[2] : t, text: peek(1).trim() });
    i += 2;
    continue;
  }

  // ---- Try it yourself
  if (t === "First Question" || /^(Second|Third|Next) Question$/.test(t)) {
    endSolution();
    const question = peek(1).trim();
    let j = i + 2;
    while (j < lines.length && !/^We recommend you to practice/.test(lines[j].trim())) j++;
    const after = lines.slice(j + 1).find((l) => l.trim());
    blocks.push({ type: "tryIt", eyebrow: t, question, answerTarget: after ? slugify(after.trim()) : undefined });
    i = j + 1;
    continue;
  }

  // ---- Pattern card
  if (/^Pattern: /.test(t)) {
    const text = mdTake(norm(peek(1)))?.text ?? peek(1).trim();
    const name = t.replace(/^Pattern:\s*/, "");
    pushBlock({ type: "pattern", title: t, text, href: `/learn/system-design/patterns/${slugify(name)}` });
    i += 2;
    continue;
  }

  // ---- Solution cards
  if (t === "Approach") {
    retroClean();
    if (solution) blocks.push(solution);
    closeList();
    const meta = overrides.solutions?.[report.solutions.length] ?? {};
    solution = {
      type: "solution",
      verdict: meta.verdict ?? "good",
      title: meta.title ?? `Option ${report.solutions.length + 1}`,
      approach: [],
      challenges: [],
    };
    solutionPart = "approach";
    report.solutions.push({ first: peek(1).trim().slice(0, 160) });
    i++;
    continue;
  }
  if (t === "Challenges" && solution) {
    retroClean();
    closeList();
    solutionPart = "challenges";
    i++;
    continue;
  }

  // ---- Code fence from markdown (all non-empty fence lines must match consecutively)
  const fenceHit = codeFences.find((f) => {
    if (f.used) return false;
    const fl = f.lines.filter((x) => x.trim());
    if (!fl.length || norm(fl[0]) !== n) return false;
    // plain-text lines may contain blank lines the fence also has; compare non-empty lines only
    const idx = [];
    for (let k = i; k < lines.length && idx.length < fl.length; k++) if (lines[k].trim()) idx.push(k);
    if (idx.length !== fl.length || !fl.every((x, k) => norm(lines[idx[k]]) === norm(x))) return false;
    f._end = idx[idx.length - 1] + 1;
    return true;
  });

  // Solution cards are absent from the markdown scrape, so a line that exists there means the
  // current solution card has ended.
  const isMdLine = mdHas(n) || !!fenceHit;
  if (isMdLine) retroClean();
  if (isMdLine && solution && solution[solutionPart].length > 0) endSolution();
  const info = fenceHit ? null : mdTake(n);

  if (fenceHit) {
    fenceHit.used = true;
    const flines = fenceHit.lines;
    pushBlock({ type: "code", code: flines.join("\n").replace(/^\n+|\n+$/g, "") });
    i = Math.max(fenceHit._end, i + 1);
    continue;
  }

  if (info) {
    if (info.kind === "li") {
      if (!listBlock || listBlock._id !== info.list) {
        closeList();
        listBlock = { type: "list", ordered: info.ordered, items: [], _id: info.list };
        if (info.ordered && info.start && info.start !== 1) listBlock.start = info.start;
        target().push(listBlock);
      }
      if (info.nested && listBlock.items.length) {
        const parent = listBlock.items[listBlock.items.length - 1];
        const obj = typeof parent === "string" ? { text: parent, children: [] } : parent;
        obj.children = obj.children ?? [];
        obj.children.push(info.text);
        listBlock.items[listBlock.items.length - 1] = obj;
      } else listBlock.items.push(info.text);
      i++;
      continue;
    }
    if (info.kind === "label") {
      pushBlock({ type: "label", text: info.text });
      i++;
      continue;
    }
    if (info.kind === "p") {
      pushBlock({ type: "paragraph", text: info.text });
      i++;
      continue;
    }
    if (info.kind === "heading") {
      // level-6 headings that aren't patterns (e.g. "Test Your Knowledge") – stop at the quiz
      if (/test your knowledge/i.test(info.text)) break;
      i++;
      continue;
    }
  }

  // ---- Unmatched content: diagram labels, code, lists, or paragraphs that only exist in the plain dump
  // Diagram label run?
  {
    let j = i;
    const runnable = (k) => {
      const l = lines[k] ?? "";
      if (!l.trim() || !looksLikeLabelLoose(l)) return false;
      if (["Approach", "Challenges"].includes(l.trim())) return false;
      if (pendingHeadings[headingPtr] && norm(l) === norm(pendingHeadings[headingPtr].text)) return false;
      if (svgByCaption.has(norm(l)) && k > i) return false; // a caption ends the run
      if (!mdHas(norm(l))) return true;
      // short markdown-matched labels inside a diagram (e.g. "Search") — only mid-run
      return k - i >= 3 && l.trim().length <= 40 && !/[.:]$/.test(l.trim()) && looksLikeLabelLoose(lines[k + 1] ?? "") && !mdHas(norm(lines[k + 1] ?? ""));
    };
    while (j < lines.length && runnable(j)) j++;
    let run = lines.slice(i, j).map((l) => l.trim());
    // The caption can coincide with text used elsewhere (a requirement, a heading). Accept it as the
    // run terminator when it directly follows a block of labels.
    const stop = (lines[j] ?? "").trim();
    if (run.length >= 3 && stop && stop.length <= 90 && !/[.:]$/.test(stop) && !["Approach", "Challenges"].includes(stop) &&
      (svgByCaption.has(norm(stop)) || /^(Approach|Challenges)$/.test((lines[j + 1] ?? "").trim()) || norm(lines[j + 1] ?? "") === norm(stop) ||
        (/requirement|entit|whiteboard/i.test(stop) && stop.length <= 60))) {
      run = [...run, stop];
      j++;
      if (mdPeek(norm(stop))?.kind !== "heading" && !headingSet.has(norm(stop))) {
        // consume the markdown occurrence only if it is a caption-like paragraph (not real content)
      }
    }
    const labelish = run.filter(looksLikeLabel).length;
    const codeish = run.filter(isCodeLine).length;
    if (run.length >= 3 && labelish >= run.length * 0.6 && codeish < run.length * 0.4) {
      // caption = last line; it is sometimes repeated twice
      let caption = run[run.length - 1];
      let body = run.slice(0, -1);
      if (body.length && norm(body[body.length - 1]) === norm(caption)) body = body.slice(0, -1);
      // caption may equal the next real line (heading / md line) instead
      const nextLine = (lines[j] ?? "").trim();
      if (svgByCaption.has(norm(nextLine)) && !mdHas(norm(nextLine))) {
        caption = nextLine;
        body = run;
        j++;
      }
      emitDiagram(caption, body);
      // skip a duplicated caption line
      if (norm(lines[j] ?? "") === norm(caption)) j++;
      i = j;
      continue;
    }
  }

  // Code run?
  if (isCodeLine(line) || (t.endsWith("{") || t === "{")) {
    let j = i;
    let depth = 0;
    const code = [];
    while (j < lines.length && lines[j].trim() && !mdHas(norm(lines[j])) && lines[j].trim() !== "Challenges" && lines[j].trim() !== "Approach") {
      const l = lines[j];
      if (!(isCodeLine(l) || depth > 0)) break;
      depth += (l.match(/[{[]/g) ?? []).length - (l.match(/[}\]]/g) ?? []).length;
      code.push(l);
      j++;
      if (depth <= 0 && code.length > 0 && !isCodeLine(lines[j] ?? "")) break;
    }
    if (code.length) {
      if (code.every((l) => /^\|.*\|$/.test(l.trim()))) pushBlock({ type: "table", rows: parseTable(code), _u: true });
      else pushBlock({ type: "code", code: code.join("\n"), _u: true });
      i = j;
      continue;
    }
  }

  // List after a "...:" lead-in?
  report.unmatched++;
  const prev = target()[target().length - 1];
  const leadIn = prev && prev.type === "paragraph" && /:\s*$/.test(prev.text);
  const termItem = /^[A-Z0-9][^:]{1,60}:\s+\S/.test(t);
  if ((leadIn || (prev && prev.type === "list" && prev._auto)) && (t.length < 320 || termItem)) {
    let lb = prev && prev.type === "list" && prev._auto ? prev : null;
    if (!lb) {
      const ordered = /(step|follow|process|works|occurs|happen|flow|sequence|order)/i.test(prev.text);
      lb = { type: "list", ordered, items: [], _auto: true, _u: true };
      target().push(lb);
    }
    lb.items.push(boldTerm(t));
    i++;
    continue;
  }
  pushBlock({ type: "paragraph", text: t, _u: true });
  i++;
}
retroClean();
endSolution();

function boldTerm(t) {
  const m = t.match(/^([A-Z0-9][^:]{1,50}):\s+(.*)$/);
  return m && !/[.!?]/.test(m[1]) ? `**${m[1]}**: ${m[2]}` : t;
}

function parseTable(rows) {
  return rows
    .filter((r) => !/^\|\s*:?-+/.test(r.trim()))
    .map((r) =>
      r
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim()),
    );
}

/* ------------------------------------------------------- post-processing */
function clean(list) {
  for (const b of list) {
    delete b._id;
    delete b._auto;
    delete b._u;
    if (b.type === "solution") {
      clean(b.approach);
      clean(b.challenges);
    }
  }
  // drop the trailing "On This Page" echo, if any slipped through
  return list;
}
clean(blocks);

// Callouts listed in overrides: wrap paragraphs whose text starts with the given prefix.
function applyCallouts(list) {
  for (let k = 0; k < list.length; k++) {
    const b = list[k];
    if (b.type === "solution") {
      applyCallouts(b.approach);
      applyCallouts(b.challenges);
      continue;
    }
    if (b.type !== "paragraph") continue;
    const hit = (overrides.callouts ?? []).find((c) => norm(b.text).startsWith(norm(c.startsWith ?? c)));
    if (hit) list[k] = { type: "callout", variant: hit.variant ?? "tip", blocks: [b] };
  }
}
applyCallouts(blocks);

// Quiz: first question from the scrape, plus authored ones from overrides.
const quiz = overrides.quiz ?? [];
if (quiz.length) blocks.push({ type: "quiz" });
if (REPORT && quizSeed) console.log("  quiz seed:", JSON.stringify(quizSeed));

const article = {
  section: GUIDE_KIND ?? "problem-breakdowns",
  slug,
  category: GUIDE_KIND ? firstLines[0] : "Common Problems",
  title: overrides.title ?? title,
  subtitle,
  seoTitle: meta.title && !/^Hello Interview/.test(meta.title) ? meta.title : `${title} | Hello Interview`,
  description:
    overrides.description ??
    subtitle ??
    `Learn how to design ${title}: requirements, core entities, API, high-level design and deep dives.`,
  // Pattern tags from the scrape header; overrides can supply them when the scrape has none.
  tags: overrides.tags?.length ? overrides.tags.map((label) => ({ label, href: `/learn/system-design/patterns/${slugify(label)}` })) : tags,
  author,
  published,
  updated: updated ?? published,
  updatedLabel: updated ? updatedLabel : "Published",
  difficulty,
  askedAt: companies.length || more ? { companies, more } : undefined,
  blocks,
  quiz,
};

/* ------------------------------------------------------- write output */
const outDir = path.join(ROOT, "src", "content", "problems");
const diagDir = path.join(ROOT, "src", "content", "diagrams", slug);
fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(diagDir, { recursive: true, force: true });
fs.mkdirSync(diagDir, { recursive: true });
for (const d of diagramFiles) fs.writeFileSync(path.join(diagDir, d.file), d.svg);
// The scrapes carry the original site's name; Blueprint hosts them now.
const json = JSON.stringify(article, null, 2)
  .replace(/\s*\|\s*Hello Interview System Design in a Hurry/g, "")
  .replace(/ \| Hello Interview/g, "")
  .replace(/Hello Interview/g, "Blueprint");
fs.writeFileSync(path.join(outDir, `${slug}.json`), json + "\n");

const unusedSvgs = svgEntries.filter((e) => !e.used);
console.log(
  `${slug}: ${blocks.length} blocks, ${report.solutions.length} solutions, ${report.diagrams} diagrams, ` +
    `${report.sketches} sketches, ${report.droppedDiagrams.length} diagrams without SVG, ${unusedSvgs.length} unused SVGs, ` +
    `${quiz.length} quiz questions`,
);
if (REPORT) {
  console.log("  headings matched:", headingPtr, "/", pendingHeadings.length);
  if (headingPtr < pendingHeadings.length) console.log("  MISSING heading:", pendingHeadings[headingPtr].text);
  report.solutions.forEach((s, k) => console.log(`  solution ${k}: ${s.first}`));
  if (report.droppedDiagrams.length) console.log("  no svg for:", report.droppedDiagrams.join(" | "));
  if (unusedSvgs.length) console.log("  unused svg captions:", unusedSvgs.map((s) => s.caption).join(" | "));
}
