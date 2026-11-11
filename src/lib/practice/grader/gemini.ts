import "server-only";
import { ApiError, GoogleGenAI, type Part } from "@google/genai";
import { FEEDBACK_JSON_SCHEMA } from "../schema";
import { BusyError, ConfigError, QuotaError, parseDuration } from "./errors";
import { parseFeedback } from "./parse";
import { SYSTEM_PROMPT, buildUserPrompt, type GradeInput } from "./prompt";
import type { ProviderResult } from "./types";

let client: GoogleGenAI | null = null;

export const geminiConfigured = () => Boolean(process.env.GEMINI_API_KEY);

/** Gemma models are served through the Gemini API but don't support JSON-schema output or system instructions. */
const isGemma = (model: string) => model.startsWith("gemma-");

const TIMEOUT_MS = 90_000;

export async function gradeWithGemini(input: GradeInput, model: string): Promise<ProviderResult> {
  // v1beta: some models (e.g. gemini-2.5-flash) reject system instructions on the default v1 API.
  client ??= new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    apiVersion: "v1beta",
    httpOptions: { timeout: TIMEOUT_MS },
  });
  const withImage = Boolean(input.canvasImage);
  const gemma = isGemma(model);

  const prompt = buildUserPrompt(input, { withImage });
  const parts: Part[] = [{ text: gemma ? `${SYSTEM_PROMPT}\n\n---\n\n${prompt}` : prompt }];
  if (withImage) parts.push({ inlineData: { mimeType: "image/png", data: input.canvasImage! } });

  const request = () =>
    client!.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: gemma
        ? { temperature: 0.3 }
        : {
            systemInstruction: SYSTEM_PROMPT,
            responseMimeType: "application/json",
            responseJsonSchema: FEEDBACK_JSON_SCHEMA,
            temperature: 0.3,
          },
    });

  try {
    let res;
    try {
      res = await request();
    } catch (err) {
      // Free-tier models often return a brief "high demand" 503; one quick retry usually gets through.
      if (!(err instanceof ApiError) || (err.status !== 503 && err.status !== 500)) throw err;
      await new Promise((r) => setTimeout(r, 1500));
      res = await request();
    }
    return { feedback: parseFeedback(res.text), imageReviewed: withImage };
  } catch (err) {
    throw classify(err);
  }
}

function classify(err: unknown): unknown {
  if (err instanceof ApiError) {
    const msg = err.message;
    if (err.status === 429) {
      // "limit: 0" = this model has no free quota at all; "per day" = daily cap reached.
      const daily = /limit:\s*0\b/.test(msg) || /per\s*day|PerDay/i.test(msg);
      return new QuotaError(msg, parseDuration(msg), daily);
    }
    if (err.status === 503 || err.status === 500 || err.status === 504) return new BusyError(msg);
    const badKey = err.status === 400 && /api[ _-]?key/i.test(msg);
    if (badKey || err.status === 401 || err.status === 403 || err.status === 404) {
      return new ConfigError(`Gemini rejected the request (${err.status}): ${msg}`);
    }
  }
  if (err instanceof Error && /timed? ?out|aborted/i.test(err.message)) return new BusyError(err.message);
  return err;
}
