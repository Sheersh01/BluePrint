import type { StepKind } from "./steps";

export interface Guidance {
  /** One-line framing of what this phase is for */
  intro: string;
  tips: { title: string; text: string }[];
  /** Where on the board to work */
  where: string;
}

export const GUIDANCE: Record<StepKind, Guidance> = {
  functional: {
    intro: "Pin down what the system must do before you design anything. Interviewers want a short, prioritized list.",
    where: "Write in the Functional Requirements box, or type below.",
    tips: [
      {
        title: "Phrase them as user capabilities",
        text: "“Users should be able to …” — three or four core ones is plenty. Order them by importance.",
      },
      {
        title: "Say what's out of scope",
        text: "Naming one or two things you're deliberately skipping shows judgment and keeps the interview focused.",
      },
    ],
  },
  "non-functional": {
    intro: "List the qualities that make this particular system hard. These drive every design choice later.",
    where: "Write in the Non-Functional Requirements box, or type below.",
    tips: [
      {
        title: "Be specific to this system",
        text: "“Highly scalable” fits everything. Say which side of a trade-off you pick and why: availability vs consistency, read vs write heavy.",
      },
      {
        title: "Put numbers on it",
        text: "Latency targets, daily users, data volume. A rough figure like “redirect in < 100 ms” beats an adjective.",
      },
    ],
  },
  entities: {
    intro: "Name the core nouns your system stores and passes around. You'll flesh out fields later as the design needs them.",
    where: "List them in the Core Entities box, or type below.",
    tips: [
      {
        title: "Keep it short",
        text: "A handful of entities is typical. Skip implementation details like tables or indexes for now.",
      },
      {
        title: "Tie them to the requirements",
        text: "Every entity should be needed by at least one functional requirement — and every requirement should touch one.",
      },
    ],
  },
  api: {
    intro: "Define the contract between clients and your system — usually one endpoint per functional requirement.",
    where: "Sketch the endpoints in the API box, or type below.",
    tips: [
      {
        title: "Method, path, body, response",
        text: "e.g. POST /posts { content } → Post. Use plural resource names and the right HTTP verb.",
      },
      {
        title: "Don't trust the client with identity",
        text: "The current user comes from the auth token or session, not from a userId in the path or body.",
      },
    ],
  },
  hld: {
    intro: "Design just enough to satisfy this one requirement end to end. Optimizations come later in the deep dives.",
    where: "Draw in the High-Level Design area, then explain the request flow below.",
    tips: [
      {
        title: "Walk the request",
        text: "Client → API gateway / service → data store and back. Label arrows with the endpoint or event they carry.",
      },
      {
        title: "Build on your earlier steps",
        text: "Reuse the entities and endpoints you already defined; add components only when a requirement needs them.",
      },
      {
        title: "Keep it simple first",
        text: "A working, simple design you can defend beats a sprawling one. You'll scale it in the next phase.",
      },
    ],
  },
  "deep-dive": {
    intro: "Now harden the design against the non-functional requirements. This is where depth and trade-offs matter.",
    where: "Update your drawing in the High-Level Design area and describe the change below.",
    tips: [
      {
        title: "Name the problem, then the fix",
        text: "Say what breaks in the current design and why, then show how your change addresses it.",
      },
      {
        title: "Weigh the options",
        text: "Mention an alternative or two and why you'd pick one. Interviewers look for the trade-off, not a single right answer.",
      },
      {
        title: "Be concrete",
        text: "Name real technologies and rough numbers where they matter — cache hit rates, partition counts, throughput.",
      },
    ],
  },
};
