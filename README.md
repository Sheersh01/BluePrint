# Blueprint

*Field notes for system design interviews.* A Next.js 16 + Tailwind v4 reading library: **115 problems, 7 patterns, 10 technologies and 100 interview questions** (11 topic pages), set in an editorial "paper" design (Newsreader + Inter, terracotta accent, light and dark).

```bash
npm install
npm run dev          # http://localhost:3000
npm run build && npm start
npm run import       # regenerate articles from content-src/ (see below)
```

## Where the content comes from

| Source | Articles | How it's built |
| --- | --- | --- |
| `src/content/problems/bitly.ts` | Bitly | hand-written TypeScript |
| `content-src/raw/<slug>.txt` | 15 scraped breakdowns + 7 scraped Key Technologies (Redis, Kafka, …) | `scripts/import-problem.mjs` (section detected from the header) |
| `content-src/authored/<slug>.md` | 99 original breakdowns, 7 Patterns, 3 Key Technologies (PostgreSQL, Flink, ZooKeeper), 11 Q&A pages (`section: questions`) | `scripts/build-authored.mjs` (`section:` / `category:` in frontmatter) |

`npm run import` rebuilds everything into `src/content/problems/*.json`, writes diagrams to `src/content/diagrams/<slug>/`, and regenerates `src/content/problems/index.ts`.

### Adding a scraped problem
Drop the scrape (plain-text dump followed by the `**Title:**` markdown half) into `content-src/raw/<slug>.txt` and run `npm run import -- --report`. The report lists the solution cards it found; add their titles/verdicts and a quiz in `content-src/overrides/<slug>.json`, then re-run.

### Writing a new problem
Create `content-src/authored/<slug>.md`. The format is documented at the top of `scripts/build-authored.mjs` — markdown plus containers such as `:::solution good Title`, `:::tip`, `:::pattern`, and fenced blocks ` ```diagram Caption ` (hand-drawn diagrams, spec in `scripts/lib/sketch.mjs`), ` ```sketch `, ` ```quiz `.

Add the slug to the sidebar (`src/content/navigation.ts`) — `src/proxy.ts` returns 404 for any article URL that isn't listed there.

### Adding interview questions
Q&A pages live in `content-src/authored/` with `section: questions` in the frontmatter. Each question is a container:

```
:::qa 14 | Define | B | What is the CAP theorem?
Answer (markdown)…
**In the interview:** one line to say out loud.
**Go deeper:** [Key-Value Store](/learn/system-design/problem-breakdowns/key-value-store)
:::
```

The type is one of Define, Compare, How, Decide, Scenario or Design, and the level is B, I or A. Numbers are global (1–100 today), so a new question takes the next number. `## Headings` group questions on a page. `npm run import` also writes `src/content/problems/questions.json`, which lets ⌘K search find any question from any page. Readers can switch on "Flashcard mode" to hide answers until they're revealed.

## Practice area (`/practice`)
A mock-interview workspace for every problem: an Excalidraw whiteboard on the right, the interview steps on the left (functional and non-functional requirements → core entities → API → one high-level-design step per requirement → one step per deep dive). For each step you draw and/or write an answer and click **Get feedback**. An AI model grades it against that article's own write-up and returns a 1–4 score with "what went well / what needs improvement / minor suggestions". **View sample answer** shows the article's section for that step.

- Steps are derived from each article's headings (`src/lib/practice/steps.ts`), so new problems get a practice mode automatically. Sections an article doesn't have are skipped.
- The board, answers and feedback are saved in the browser's localStorage (`bp:practice:<slug>:*`).
- Grading runs server-side in `src/app/api/practice/feedback/route.ts` (providers live in `src/lib/practice/grader/`). Both supported providers have free tiers:

| Provider | Env var | Notes |
| --- | --- | --- |
| Google Gemini (recommended) | `GEMINI_API_KEY` (optional `GEMINI_MODEL`, default `gemini-3.6-flash`) | Free key at <https://aistudio.google.com/apikey>. Reads the whiteboard image. |
| Groq (optional backup) | `GROQ_API_KEY` (optional `GROQ_MODEL`, default `qwen/qwen3.8-27b`) | Free key at <https://console.groq.com/keys>. Used if Gemini isn't set or hits its quota. If the model can't take images, it grades from the board's text labels. |

Copy `.env.example` to `.env.local`, fill in a key and restart the server. Without a key the practice area still works: "Get feedback" explains that AI feedback isn't set up and offers the sample answer instead.

**Staying within free limits.** Free quotas are counted per model, so the grader works down a chain of models and only moves on when the one above is out of quota or overloaded. The best model always goes first:

`gemini-3.6-flash` → `gemini-3.5-flash` → `gemini-2.5-flash` → Groq `qwen/qwen3.8-27b` → `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → Groq `openai/gpt-oss-120b` (text only) → `gemma-4-26b-a4b-it` (slow, last resort)

- A model that reports a limit is skipped until it should be ready again: per-minute limits for the time it asks, daily limits for an hour at a time. A short per-minute wait (≤ 15 s) on a better model is waited out instead of falling to a weaker one.
- Gemini's "high demand" errors are retried once, then the next model takes over.
- An unchanged answer isn't sent again. The workspace says nothing has changed. Identical requests are also answered from a server-side cache.
- The whiteboard image is only sent when the step's area contains a drawing. Text-only notes go as text, and images are sized to the area (1024 px for the small boxes, 1400 px for the design area).
- The feedback shows which model wrote it.
- Override the order with `AI_MODEL_CHAIN="gemini:model-a,groq:model-b,…"` in `.env.local`.

## Code Review questions (`section: code-review`)
"Here's some code — what's wrong with it?" rounds. Each page in `content-src/authored/` follows the same structure:
1. a Quick Reference table and a decision-tree mental model;
2. the buggy code, then what most candidates catch and what they miss;
3. the interviewer's follow-ups (`:::info Interviewer asks`), each with a model answer (`:::tip Say this`);
4. a master answer, then the fixed code;
5. the learning escalation, the next HLD challenge, and a cheat sheet.

`money-transfer.md` is the original. Copy its structure for new ones and add the slug to `navigation.ts`.

## Tags (`/tags`)
Every problem (standard and real-life) carries three kinds of tag:

| Group | Example | Where it's defined |
| --- | --- | --- |
| Domain: what kind of product | Payments & Finance | `PROBLEM_TAGS` in `src/content/tags.ts` |
| Topic: the key technical ideas | Geospatial Indexing, Idempotency | `PROBLEM_TAGS` in `src/content/tags.ts` |
| Pattern: the reusable patterns | Scaling Reads | the article's own `tags:` (frontmatter, or `tags` in `content-src/overrides/<slug>.json` for scraped problems) |

Tags show as chips on each problem and link to a tag page (`/tags/<id>`) listing every problem with that tag, plus the tags it most often appears with. Search (⌘K) matches tag names, and the Practice page can filter by tag. **When you add a problem**, add a `PROBLEM_TAGS` entry for its slug. Tag ids are typed, so a misspelt tag fails the build.

## Notes
- On a machine that's short on RAM, `next build` can run out of memory with many parallel workers. Use fewer: `BUILD_CPUS=2 npm run build`.
- Brand name and tagline: `src/config/site.ts`. Colours and fonts: the tokens at the top of `src/app/globals.css`.
- The importers rewrite the original site name in scraped text to "Blueprint"; author bylines are kept.
- Diagram font is Excalidraw's Virgil (OFL), self-hosted in `public/fonts`.
- `build`/`start` force `NODE_ENV=production` because a global `NODE_ENV=development` breaks `next build`.
