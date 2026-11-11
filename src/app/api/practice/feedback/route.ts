import { buildPracticePlan, getPracticeArticle } from "@/lib/practice/steps";
import { blocksToPlainText } from "@/lib/practice/text";
import { FeedbackRequestSchema, type FeedbackError, type FeedbackResponse } from "@/lib/practice/schema";
import { BusyError, ConfigError, QuotaError, grade, graderConfigured, nextAvailableInMs } from "@/lib/practice/grader";

const fail = (status: number, body: FeedbackError) => Response.json(body, { status });

function waitText(ms: number) {
  if (ms < 90_000) return "in about a minute";
  if (ms < 3_600_000) return `in about ${Math.ceil(ms / 60_000)} minutes`;
  return "later today (free daily limits reset at midnight Pacific time)";
}

export async function POST(request: Request) {
  if (!graderConfigured()) {
    return fail(503, {
      unavailable: true,
      error: "AI feedback isn't set up yet. Add a free GEMINI_API_KEY to web/.env.local and restart the server.",
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, { error: "Invalid request." });
  }
  const parsed = FeedbackRequestSchema.safeParse(body);
  if (!parsed.success) return fail(400, { error: "Invalid request." });
  const req = parsed.data;

  // The reference answer always comes from the article on the server, never from the client.
  const article = getPracticeArticle(req.slug);
  if (!article) return fail(404, { error: "Unknown problem." });
  const plan = buildPracticePlan(article);
  const step = plan.steps.find((s) => s.id === req.stepId);
  if (!step) return fail(404, { error: "Unknown step." });

  if (!req.answer.trim() && !req.canvasText.trim() && !req.canvasImage) {
    return fail(400, { error: "Write or draw an answer first." });
  }

  try {
    const result = await grade({
      problemTitle: article.title,
      problemSummary: plan.summary,
      stepKind: step.kind,
      question: step.question,
      referenceAnswer: blocksToPlainText(step.sampleBlocks).slice(0, 24_000),
      levelExpectations: blocksToPlainText(plan.levelBlocks).slice(0, 6_000),
      priorAnswers: req.priorAnswers,
      answer: req.answer,
      canvasText: req.canvasText,
      canvasImage: req.canvasImage || undefined,
      previousFeedback: req.previousFeedback,
    });
    const body: FeedbackResponse = {
      feedback: result.feedback,
      imageReviewed: result.imageReviewed,
      model: result.model,
    };
    return Response.json(body);
  } catch (err) {
    if (err instanceof QuotaError) {
      return fail(429, {
        quota: true,
        error: `Every free AI model is at its limit right now. Try again ${waitText(nextAvailableInMs())}.`,
      });
    }
    if (err instanceof BusyError) {
      return fail(503, { error: "The AI models are busy right now. Please try again in a moment." });
    }
    if (err instanceof ConfigError) {
      console.error("[practice] grader configuration problem:", err.message);
      return fail(503, {
        unavailable: true,
        error: "The AI provider rejected the request. Check the API key and model name in web/.env.local.",
      });
    }
    console.error("[practice] grading failed:", err);
    return fail(502, { error: "Couldn't get feedback right now. Please try again." });
  }
}
