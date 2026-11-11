import type { Feedback } from "../schema";

export interface ProviderResult {
  feedback: Feedback;
  /** Whether the model actually looked at the whiteboard image (when one was sent) */
  imageReviewed: boolean;
}

/** One model in the fallback chain. */
export interface Slot {
  provider: "gemini" | "groq";
  model: string;
  /** false for text-only models: the whiteboard image is never sent to them */
  vision: boolean;
}
