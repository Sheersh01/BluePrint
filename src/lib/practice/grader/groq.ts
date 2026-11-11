import "server-only";
import { BusyError, ConfigError, QuotaError, parseDuration } from "./errors";
import { parseFeedback } from "./parse";
import { SYSTEM_PROMPT, buildUserPrompt, type GradeInput } from "./prompt";
import type { ProviderResult } from "./types";

// Groq exposes an OpenAI-compatible endpoint.
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export const groqConfigured = () => Boolean(process.env.GROQ_API_KEY);

/**
 * Groq's free tier allows only ~8000 tokens a minute, so the long parts of the prompt
 * (reference write-up, level expectations, earlier answers) are trimmed to fit.
 */
function fitToFreeTier(input: GradeInput): GradeInput {
  const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "\n[…trimmed]" : s);
  return {
    ...input,
    referenceAnswer: cut(input.referenceAnswer, 9000),
    levelExpectations: cut(input.levelExpectations, 1500),
    priorAnswers: input.priorAnswers.slice(-6).map((p) => ({ ...p, answer: cut(p.answer, 600) })),
    answer: cut(input.answer, 4000),
    canvasText: cut(input.canvasText, 2000),
  };
}

async function call(input: GradeInput, model: string, withImage: boolean) {
  const text = buildUserPrompt(input, { withImage });
  const content = withImage
    ? [
        { type: "text", text },
        { type: "image_url", image_url: { url: `data:image/png;base64,${input.canvasImage}` } },
      ]
    : text;

  return fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
}

export async function gradeWithGroq(full: GradeInput, model: string, vision: boolean): Promise<ProviderResult> {
  const input = fitToFreeTier(full);
  let withImage = vision && Boolean(input.canvasImage);
  let res: Response;
  try {
    res = await call(input, model, withImage);
    // The model may reject the image (or it's too large): fall back to text only.
    if (withImage && (res.status === 400 || res.status === 413)) {
      withImage = false;
      res = await call(input, model, false);
    }
  } catch (err) {
    throw new BusyError(err instanceof Error ? err.message : "Groq request failed");
  }

  if (res.status === 429) {
    const body = await res.text();
    const header = Number(res.headers.get("retry-after"));
    const retry = parseDuration(body) ?? (header > 0 ? header * 1000 : undefined);
    throw new QuotaError(`Groq rate limit: ${body.slice(0, 300)}`, retry, /per day|\(RPD\)|\(TPD\)/i.test(body));
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new ConfigError(`Groq rejected the request (${res.status})`);
  }
  if (res.status >= 500) throw new BusyError(`Groq is unavailable (${res.status})`);
  if (!res.ok) throw new Error(`Groq request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return { feedback: parseFeedback(json.choices?.[0]?.message?.content), imageReviewed: withImage };
}
