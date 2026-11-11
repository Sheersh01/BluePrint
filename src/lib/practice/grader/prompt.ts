import type { Feedback } from "../schema";
import type { StepKind } from "../steps";

export interface GradeInput {
  problemTitle: string;
  problemSummary: string;
  stepKind: StepKind;
  question: string;
  referenceAnswer: string;
  levelExpectations: string;
  priorAnswers: { question: string; answer: string }[];
  answer: string;
  canvasText: string;
  /** Base64 PNG of the relevant part of the whiteboard */
  canvasImage?: string;
  previousFeedback?: Feedback;
}

export const SYSTEM_PROMPT = `You are a senior engineer running a mock system design interview. The candidate answers one step of the interview at a time, by drawing on a whiteboard and/or writing an explanation. You review that single step and give feedback the way a fair, experienced interviewer would in a debrief.

How to grade:
- Judge only the scope of the current step. Do not penalize the candidate for leaving out things that belong to later steps (for example, scaling details while they are still listing requirements).
- You are given a reference write-up. It is one strong answer, not the only one. Credit any approach that is technically sound and fits the requirements, even if it differs from the reference.
- Read both the written answer and the whiteboard (image and/or its extracted text labels). Treat them as one answer.
- Earlier answers from this session are included. If something asked here was already covered earlier, give credit for it.
- Be specific: quote or name what the candidate actually wrote or drew. Explain why each point matters for this particular system. When suggesting a fix, show how they could phrase or draw it.
- Speak directly to the candidate ("you"). Keep each item to 1-3 sentences. Use plain text only, no markdown.
- If previous feedback for this step is included, this is a retry: say what they fixed, and if an earlier point is still not addressed, say so explicitly ("You still haven't...").
- Do not invent requirements that are not part of the problem.

Score (integer):
4 = everything an interviewer would expect for this step, no meaningful mistakes.
3 = the core is right, with one notable gap or imprecision.
2 = partly right: misses a key element or contains a real mistake.
1 = mostly missing, wrong, or off-topic (an empty answer is a 1).

Lists:
- wentWell: 1-4 concrete strengths (may be empty only for a score of 1).
- needsImprovement: the important gaps or mistakes, most important first (empty for a 4 is fine).
- minorSuggestions: 0-3 small polish items.

Reply with JSON only, exactly in this shape:
{"score": 1-4, "wentWell": [string], "needsImprovement": [string], "minorSuggestions": [string]}`;

const STEP_FOCUS: Record<StepKind, string> = {
  functional:
    "Functional requirements: the core user-facing capabilities, prioritized, with out-of-scope items called out.",
  "non-functional":
    "Non-functional requirements: the system qualities that matter most for THIS problem (consistency vs availability, latency, scale, durability...), ideally quantified.",
  entities: "Core entities: the main nouns the system stores and exchanges. Full schemas are not required yet.",
  api: "API design: an endpoint per functional requirement with sensible methods, paths, request bodies and responses.",
  hld: "High-level design for ONE functional requirement: the components and the request flow end to end. Optimizations come later in deep dives.",
  "deep-dive":
    "Deep dive: how the design changes to address this specific concern, the trade-offs, and concrete technologies or numbers where they matter.",
};

export function buildUserPrompt(input: GradeInput, { withImage }: { withImage: boolean }) {
  const parts = [
    `# Problem: ${input.problemTitle}`,
    input.problemSummary,
    `# Current step\n${input.question}\nFocus: ${STEP_FOCUS[input.stepKind]}`,
    `# Reference write-up for this step\n${input.referenceAnswer || "(none available)"}`,
  ];
  if (input.levelExpectations) parts.push(`# What interviewers expect at each level\n${input.levelExpectations}`);
  if (input.priorAnswers.length) {
    parts.push(
      `# Candidate's earlier answers in this session\n` +
        input.priorAnswers.map((p) => `Q: ${p.question}\nA: ${p.answer}`).join("\n\n"),
    );
  }
  if (input.previousFeedback) {
    const f = input.previousFeedback;
    parts.push(
      `# Previous feedback on this step (this is a retry)\nScore: ${f.score}/4\nNeeds improvement:\n${f.needsImprovement
        .map((s) => `- ${s}`)
        .join("\n")}\nMinor suggestions:\n${f.minorSuggestions.map((s) => `- ${s}`).join("\n")}`,
    );
  }
  parts.push(`# Candidate's written answer\n${input.answer.trim() || "(nothing written)"}`);
  parts.push(`# Text on the candidate's whiteboard (for this step)\n${input.canvasText.trim() || "(no text on the board)"}`);
  parts.push(
    withImage && input.canvasImage
      ? "The attached image is the candidate's whiteboard for this step."
      : "No whiteboard image is available; judge the drawing only from the text labels above.",
  );
  parts.push("Return the JSON feedback now.");
  return parts.join("\n\n");
}
