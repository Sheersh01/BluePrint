import { z } from "zod";

/** What the grader returns for one step. */
export const FeedbackSchema = z.object({
  /** 1 = not there yet, 2 = on the right track, 3 = good, 4 = great */
  score: z.number().int().min(1).max(4),
  wentWell: z.array(z.string()).max(6),
  needsImprovement: z.array(z.string()).max(6),
  minorSuggestions: z.array(z.string()).max(6),
});
export type Feedback = z.infer<typeof FeedbackSchema>;

/** Same shape as a plain JSON Schema, for providers that take one. */
export const FEEDBACK_JSON_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", minimum: 1, maximum: 4 },
    wentWell: { type: "array", items: { type: "string" }, maxItems: 5 },
    needsImprovement: { type: "array", items: { type: "string" }, maxItems: 5 },
    minorSuggestions: { type: "array", items: { type: "string" }, maxItems: 5 },
  },
  required: ["score", "wentWell", "needsImprovement", "minorSuggestions"],
} as const;

const MAX_IMAGE_CHARS = 4_000_000; // ~3 MB of PNG as base64

export const FeedbackRequestSchema = z.object({
  slug: z.string().min(1).max(120),
  stepId: z.string().min(1).max(20),
  answer: z.string().max(8000),
  canvasText: z.string().max(8000),
  /** Base64 PNG (no data: prefix) of the relevant part of the board */
  canvasImage: z
    .string()
    .max(MAX_IMAGE_CHARS)
    .regex(/^[A-Za-z0-9+/=]*$/)
    .optional(),
  priorAnswers: z
    .array(z.object({ question: z.string().max(400), answer: z.string().max(2000) }))
    .max(20)
    .default([]),
  previousFeedback: FeedbackSchema.optional(),
});
export type FeedbackRequest = z.input<typeof FeedbackRequestSchema>;

export interface FeedbackResponse {
  feedback: Feedback;
  /** The model that wrote the feedback */
  model: string;
  /** false when a drawing was sent but the model could only read its text labels */
  imageReviewed: boolean;
}

export interface FeedbackError {
  error: string;
  /** No AI key configured on the server */
  unavailable?: boolean;
  /** Free-tier quota used up */
  quota?: boolean;
}
