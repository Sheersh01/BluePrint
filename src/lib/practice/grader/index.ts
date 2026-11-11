import "server-only";
import { createHash } from "node:crypto";
import type { Feedback } from "../schema";
import { BadOutputError, BusyError, ConfigError, QuotaError } from "./errors";
import { geminiConfigured, gradeWithGemini } from "./gemini";
import { groqConfigured, gradeWithGroq } from "./groq";
import type { GradeInput } from "./prompt";
import type { Slot } from "./types";

export { BadOutputError, ConfigError, QuotaError };
export type { GradeInput };

/**
 * Models are tried in this order. Free-tier quotas are counted per model, so falling back
 * through several models multiplies the daily allowance. The first entry is the best grader;
 * the rest are only used when the ones above are out of quota or overloaded.
 * Override with AI_MODEL_CHAIN="gemini:model-a,groq:model-b,…".
 */
function defaultChain(): string[] {
  return [
    `gemini:${process.env.GEMINI_MODEL || "gemini-3.6-flash"}`,
    "gemini:gemini-3.5-flash",
    "gemini:gemini-2.5-flash",
    `groq:${process.env.GROQ_MODEL || "qwen/qwen3.8-27b"}`,
    "gemini:gemini-3.5-flash-lite",
    "gemini:gemini-3.1-flash-lite",
    "groq:openai/gpt-oss-120b", // text only: grades from the board's labels
    "gemini:gemma-4-26b-a4b-it", // good feedback but ~70 s per review, so it's the last resort
  ];
}

const TEXT_ONLY = /gpt-oss|llama-3|allam/i;

function chain(): Slot[] {
  const spec = process.env.AI_MODEL_CHAIN?.trim() ? process.env.AI_MODEL_CHAIN.split(",") : defaultChain();
  const seen = new Set<string>();
  const slots: Slot[] = [];
  for (const raw of spec) {
    const entry = raw.trim();
    const i = entry.indexOf(":");
    if (i < 0) continue;
    const provider = entry.slice(0, i).trim();
    const model = entry.slice(i + 1).trim();
    if ((provider !== "gemini" && provider !== "groq") || !model || seen.has(entry)) continue;
    if (provider === "gemini" ? !geminiConfigured() : !groqConfigured()) continue;
    seen.add(entry);
    slots.push({ provider, model, vision: !TEXT_ONLY.test(model) });
  }
  return slots;
}

export const graderConfigured = () => chain().length > 0;

// ---------- Per-model cool-downs (this server process only) ----------
// A model that reported "out of quota" is skipped until it's likely to accept requests again,
// so we don't burn time (or requests) on it for every submission.

const coolUntil = new Map<string, number>();
const slotKey = (s: Slot) => `${s.provider}:${s.model}`;
const isCooling = (s: Slot) => (coolUntil.get(slotKey(s)) ?? 0) > Date.now();
const coolDown = (s: Slot, ms: number) => coolUntil.set(slotKey(s), Date.now() + ms);

function cooldownFor(err: unknown): number {
  if (err instanceof QuotaError) {
    // Daily caps reset at midnight Pacific; re-check hourly rather than computing the reset time.
    if (err.daily) return Math.min(err.retryAfterMs ?? 3_600_000, 3_600_000);
    return err.retryAfterMs ?? 60_000;
  }
  if (err instanceof BusyError) return 30_000;
  if (err instanceof BadOutputError) return 60_000;
  // Unknown model, bad key, or a request the model rejects: don't keep retrying it on every submission.
  return 10 * 60_000;
}

// ---------- Result cache ----------
// Identical submissions (e.g. a resend after a network blip) are answered without another request.

const cache = new Map<string, { feedback: Feedback; imageReviewed: boolean; model: string }>();
const CACHE_MAX = 200;
const cacheKey = (input: GradeInput) => createHash("sha256").update(JSON.stringify(input)).digest("hex");

/** A short per-minute limit on a better model is worth waiting for rather than dropping to a weaker one. */
const MAX_WAIT_MS = 15_000;
/** Cool-downs up to this long are "maybe ready again"; longer ones are skipped outright. */
const SHORT_COOLDOWN_MS = 2 * 60_000;

async function run(slot: Slot, input: GradeInput) {
  const slotInput = slot.vision ? input : { ...input, canvasImage: undefined };
  const result =
    slot.provider === "gemini"
      ? await gradeWithGemini(slotInput, slot.model)
      : await gradeWithGroq(slotInput, slot.model, slot.vision);
  return { ...result, imageReviewed: input.canvasImage ? result.imageReviewed : true };
}

/**
 * Grades one step with the best available model. Each model gets one retry on a malformed reply;
 * a short per-minute limit is waited out once; otherwise we move down the chain.
 */
export async function grade(input: GradeInput) {
  const slots = chain();
  if (slots.length === 0) throw new ConfigError("No AI provider key is configured");

  const key = cacheKey(input);
  const hit = cache.get(key);
  if (hit) return { ...hit, cached: true };

  const errors: unknown[] = [];
  let waited = false;
  // Models that aren't cooling down go first, in chain order. Models on a short cool-down
  // (busy, per-minute limit) are still worth a try, soonest-available first. Models on a long
  // one (daily cap reached, no free quota) are skipped until it expires.
  const now = Date.now();
  const remaining = (s: Slot) => (coolUntil.get(slotKey(s)) ?? 0) - now;
  const ordered = [
    ...slots.filter((s) => !isCooling(s)),
    ...slots.filter((s) => isCooling(s) && remaining(s) <= SHORT_COOLDOWN_MS).sort((a, b) => remaining(a) - remaining(b)),
  ];
  if (ordered.length === 0) {
    throw new QuotaError("All models are cooling down", nextAvailableInMs(), true);
  }

  for (const slot of ordered) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await run(slot, input);
        coolUntil.delete(slotKey(slot));
        const value = { ...result, model: slot.model };
        cache.set(key, value);
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
        return { ...value, cached: false };
      } catch (err) {
        if (err instanceof BadOutputError && attempt === 0) continue;
        if (
          err instanceof QuotaError &&
          !err.daily &&
          !waited &&
          attempt === 0 &&
          err.retryAfterMs !== undefined &&
          err.retryAfterMs <= MAX_WAIT_MS
        ) {
          waited = true;
          await new Promise((r) => setTimeout(r, err.retryAfterMs! + 250));
          continue;
        }
        const ms = cooldownFor(err);
        if (ms) coolDown(slot, ms);
        console.warn(`[practice] ${slotKey(slot)} failed:`, err instanceof Error ? err.message.slice(0, 200) : err);
        errors.push(err);
        break;
      }
    }
  }
  // Report the most actionable failure: "busy" is temporary, so it beats a quota message.
  throw (
    errors.find((e) => e instanceof BusyError) ??
    errors.find((e) => e instanceof QuotaError) ??
    errors.find((e) => e instanceof ConfigError) ??
    errors[0]
  );
}

/** Earliest time any model is expected to accept requests again (for the "try again in…" message). */
export function nextAvailableInMs() {
  const now = Date.now();
  const times = chain().map((s) => (coolUntil.get(slotKey(s)) ?? now) - now);
  return times.length ? Math.max(0, Math.min(...times)) : 0;
}

export { BusyError };
