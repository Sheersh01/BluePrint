import { FeedbackSchema, type Feedback } from "../schema";
import { BadOutputError } from "./errors";

/** Parses a model reply into Feedback, tolerating code fences and stray text around the JSON. */
export function parseFeedback(raw: string | undefined | null): Feedback {
  if (!raw) throw new BadOutputError("empty reply");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new BadOutputError("no JSON object in reply");
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new BadOutputError("invalid JSON");
  }
  // Be lenient about list lengths and score rounding before validating.
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.score === "number") d.score = Math.min(4, Math.max(1, Math.round(d.score)));
    if (typeof d.score === "string") d.score = Math.min(4, Math.max(1, Math.round(Number(d.score) || 1)));
    for (const k of ["wentWell", "needsImprovement", "minorSuggestions"]) {
      if (d[k] == null) d[k] = [];
      if (Array.isArray(d[k])) {
        d[k] = (d[k] as unknown[])
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .map((s) => s.trim())
          .slice(0, 6);
      }
    }
  }
  const parsed = FeedbackSchema.safeParse(data);
  if (!parsed.success) throw new BadOutputError("reply did not match the feedback shape");
  return parsed.data;
}
