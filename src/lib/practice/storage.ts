"use client";

import type { Feedback } from "./schema";

/** Saved state for one step of a practice session. */
export interface StepRecord {
  answer: string;
  /** Text read off the whiteboard when this step was last graded */
  boardText?: string;
  /** Fingerprint of the answer + board when last graded (to avoid regrading an unchanged answer) */
  signature?: string;
  /** Model that wrote the latest feedback */
  model?: string;
  feedback?: Feedback;
  /** false when the grader only saw text (no drawing) */
  imageReviewed?: boolean;
  attempts: number;
  skipped?: boolean;
}

export interface PracticeSession {
  current: number;
  finished?: boolean;
  records: Record<string, StepRecord>;
}

const sessionKey = (slug: string) => `bp:practice:${slug}:session`;
const sceneKey = (slug: string) => `bp:practice:${slug}:scene`;
const EMPTY: PracticeSession = { current: 0, records: {} };

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // storage full or unavailable
  }
}

export const loadSession = (slug: string): PracticeSession => readJSON<PracticeSession>(sessionKey(slug)) ?? EMPTY;
export const saveSession = (slug: string, s: PracticeSession) => writeJSON(sessionKey(slug), s);
export const clearSession = (slug: string) => {
  try {
    localStorage.removeItem(sessionKey(slug));
  } catch {
    /* ignore */
  }
};

export interface SavedScene {
  elements: unknown[];
  files?: Record<string, unknown>;
}
export const loadScene = (slug: string) => readJSON<SavedScene>(sceneKey(slug));
export const saveScene = (slug: string, scene: SavedScene) => {
  // Pasted images can blow the storage quota; keep the drawing even if the images don't fit.
  if (!writeJSON(sceneKey(slug), scene)) writeJSON(sceneKey(slug), { elements: scene.elements });
};
export const clearScene = (slug: string) => {
  try {
    localStorage.removeItem(sceneKey(slug));
  } catch {
    /* ignore */
  }
};

/** Per-problem progress for the practice index. */
export function sessionProgress(slug: string) {
  const s = readJSON<PracticeSession>(sessionKey(slug));
  if (!s) return null;
  const graded = Object.values(s.records).filter((r) => r.feedback);
  if (graded.length === 0) return null;
  const avg = graded.reduce((n, r) => n + r.feedback!.score, 0) / graded.length;
  return { graded: graded.length, avg, finished: Boolean(s.finished) };
}

export const SCORE_LABEL: Record<number, string> = {
  1: "Not there yet",
  2: "On the right track",
  3: "Good answer",
  4: "Great answer",
};

export const SCORE_HEADLINE: Record<number, string> = {
  1: "Not quite there yet — let's fix the gaps.",
  2: "You're on the right track.",
  3: "Good answer. A couple of things to tighten.",
  4: "Great answer. Nothing essential missing.",
};

/** Tailwind text/bg color for a score (bad → teal → moss). */
export const scoreTone = (score: number | undefined) =>
  score == null ? "faint" : score <= 1 ? "bad" : score === 2 ? "good" : "great";
