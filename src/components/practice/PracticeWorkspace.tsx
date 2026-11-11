"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, Clock, Lightbulb, Loader2, Quote, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { StepMeta } from "@/lib/practice/steps";
import type { FeedbackError, FeedbackRequest, FeedbackResponse } from "@/lib/practice/schema";
import { GUIDANCE } from "@/lib/practice/guidance";
import { loadSession, saveSession, type PracticeSession, type StepRecord } from "@/lib/practice/storage";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import type { CanvasController } from "./PracticeCanvas";
import { StepNav } from "./StepNav";
import { FeedbackCard } from "./FeedbackCard";
import { SampleAnswerDialog } from "./SampleAnswerDialog";
import { PracticeSummary } from "./PracticeSummary";

const PracticeCanvas = dynamic(() => import("./PracticeCanvas"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center text-[13px] text-muted">
      <span className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading whiteboard…
      </span>
    </div>
  ),
});

export interface WorkspaceProps {
  slug: string;
  title: string;
  summary: string;
  articleHref: string;
  steps: StepMeta[];
  /** Pre-rendered sample answer per step (same order as steps) */
  samples: ReactNode[];
  /** true when the article has no write-up for that step */
  emptySamples: boolean[];
}

type Tab = "how" | "answer" | "feedback";
type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "notice"; message: string }
  | { kind: "error"; message: string; unavailable?: boolean; quota?: boolean };

const BLANK: StepRecord = { answer: "", attempts: 0 };
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Seconds spent on the current step; restarts whenever `resetKey` changes. Pauses while the tab is hidden. */
function useElapsed(resetKey: unknown) {
  const [seconds, setSeconds] = useState(0);
  const [lastKey, setLastKey] = useState(resetKey);
  if (lastKey !== resetKey) {
    setLastKey(resetKey);
    setSeconds(0);
  }
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(t);
  }, []);
  return seconds;
}

export default function PracticeWorkspace({
  slug,
  title,
  summary,
  articleHref,
  steps,
  samples,
  emptySamples,
}: WorkspaceProps) {
  const [session, setSession] = useState<PracticeSession>(() => {
    const s = loadSession(slug);
    return { ...s, current: Math.min(Math.max(0, s.current), steps.length - 1) };
  });
  const current = session.current;
  const step = steps[current];
  const record = session.records[step.id] ?? BLANK;

  const [retrying, setRetrying] = useState(false);
  const [tab, setTab] = useState<Tab>(record.feedback ? "feedback" : "how");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [showSample, setShowSample] = useState(false);
  const controller = useRef<CanvasController | null>(null);
  const elapsed = useElapsed(`${current}:${session.finished}`);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveSession(slug, session);
  }, [slug, session]);

  const onCanvasReady = useCallback((c: CanvasController) => {
    controller.current = c;
  }, []);

  const updateRecord = (id: string, patch: Partial<StepRecord>) =>
    setSession((s) => ({ ...s, records: { ...s.records, [id]: { ...BLANK, ...s.records[id], ...patch } } }));

  const go = (i: number) => {
    const next = Math.min(Math.max(0, i), steps.length - 1);
    setSession((s) => ({ ...s, current: next, finished: false }));
    setRetrying(false);
    setStatus({ kind: "idle" });
    setTab(session.records[steps[next].id]?.feedback ? "feedback" : "how");
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const finish = () => setSession((s) => ({ ...s, finished: true }));
  const isLast = current === steps.length - 1;
  const advance = () => (isLast ? finish() : go(current + 1));

  const skip = () => {
    if (!record.feedback) updateRecord(step.id, { skipped: true });
    advance();
  };

  const getFeedback = async () => {
    if (status.kind === "loading") return;
    setStatus({ kind: "loading" });
    try {
      const board = (await controller.current?.snapshot(step.frame)) ?? { text: "", version: "" };
      if (!record.answer.trim() && !board.version) {
        setStatus({ kind: "error", message: "Write your answer below or draw it on the board first." });
        return;
      }
      // Nothing changed since the last feedback: show it again instead of spending a request.
      const signature = `${record.answer.trim()}\u0000${board.version}`;
      if (record.feedback && record.signature === signature) {
        setStatus({
          kind: "notice",
          message: "Nothing has changed since your last feedback. Edit your answer or drawing, then try again.",
        });
        return;
      }

      // Earlier answers give the grader context ("you already covered this").
      const priorAnswers: FeedbackRequest["priorAnswers"] = [];
      const seenFrames = new Set<string>();
      for (const s of steps.slice(0, current)) {
        const written = session.records[s.id]?.answer.trim() ?? "";
        let boardText = "";
        if (s.frame !== "hld" && s.frame !== step.frame && !seenFrames.has(s.frame)) {
          seenFrames.add(s.frame);
          boardText = (await controller.current?.snapshot(s.frame, { image: false }))?.text ?? "";
        }
        const combined = [written, boardText && `On the board:\n${boardText}`].filter(Boolean).join("\n");
        if (combined) priorAnswers.push({ question: s.question, answer: combined.slice(0, 2000) });
      }

      const body: FeedbackRequest = {
        slug,
        stepId: step.id,
        answer: record.answer,
        canvasText: board.text.slice(0, 8000),
        canvasImage: board.image,
        priorAnswers,
        previousFeedback: record.feedback,
      };
      const res = await fetch("/api/practice/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({ error: "Unexpected response from the server." }))) as
        | FeedbackResponse
        | FeedbackError;
      if (!res.ok || "error" in data) {
        const err = data as FeedbackError;
        setStatus({ kind: "error", message: err.error, unavailable: err.unavailable, quota: err.quota });
        return;
      }
      updateRecord(step.id, {
        feedback: data.feedback,
        imageReviewed: data.imageReviewed,
        model: data.model,
        signature,
        boardText: board.text,
        attempts: record.attempts + 1,
        skipped: false,
      });
      setRetrying(false);
      setTab("feedback");
      setStatus({ kind: "idle" });
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setStatus({ kind: "error", message: "Couldn't reach the server. Check your connection and try again." });
    }
  };

  const editing = !record.feedback || retrying;
  const guide = GUIDANCE[step.kind];
  const overTime = elapsed > step.minutes * 60;
  const tabs: { id: Tab; label: string }[] = [
    { id: "how", label: "How to answer" },
    ...(record.feedback ? [{ id: "answer" as Tab, label: "Your answer" }] : []),
    ...(record.feedback ? [{ id: "feedback" as Tab, label: retrying ? "Last feedback" : "Feedback" }] : []),
  ];
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "how";

  return (
    <div className="flex min-h-dvh flex-col bg-bg lg:h-dvh lg:flex-row">
      {/* ---------- Interview panel ---------- */}
      <aside className="flex w-full flex-col border-line lg:h-full lg:w-[440px] lg:shrink-0 lg:border-r xl:w-[480px]">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <Link
            href={articleHref}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Exit
          </Link>
          <p className="min-w-0 flex-1 truncate text-center font-serif text-[16px] text-ink">{title}</p>
          <ThemeToggle />
        </div>

        <div className="border-b border-line px-4 pt-3 pb-2">
          <StepNav steps={steps} records={session.records} current={current} onGo={go} />
        </div>

        {session.finished ? (
          <div ref={scrollRef} className="thin-scroll flex-1 overflow-y-auto px-6 py-6">
            <PracticeSummary
              slug={slug}
              steps={steps}
              records={session.records}
              articleHref={articleHref}
              onReview={go}
              onRestart={() => {
                setSession({ current: 0, records: {} });
                setTab("how");
              }}
            />
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="thin-scroll flex-1 overflow-y-auto px-6 pt-6 pb-8">
              <p className="flex items-center justify-between">
                <span className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-[11.5px] font-medium text-body">
                  {step.chip}
                </span>
                <span className="text-[12px] text-faint">
                  Step {current + 1} of {steps.length}
                </span>
              </p>
              <h1 className="mt-3 font-serif text-[25px] leading-[1.2] font-medium tracking-[-0.01em] text-ink">
                {step.question}
              </h1>

              {editing && (
                <div className="mt-5">
                  <p className="text-[13px] text-muted">
                    {retrying ? "Edit your answer or drawing, then get feedback again." : guide.where}
                  </p>
                  <textarea
                    value={record.answer}
                    onChange={(e) => updateRecord(step.id, { answer: e.target.value })}
                    placeholder={
                      step.frame === "hld"
                        ? "Walk through your design: the components, how a request flows, and why…"
                        : "Type your answer here (optional if it's on the board)…"
                    }
                    rows={step.frame === "hld" ? 8 : 5}
                    maxLength={8000}
                    className="mt-2 block w-full resize-y rounded-md border border-line bg-surface px-3.5 py-3 text-[14.5px] leading-relaxed text-ink placeholder:text-faint focus:border-primary focus:outline-none"
                  />
                  <div className="mt-3 flex items-center gap-2">
                    <span
                      className={`flex items-center gap-1.5 font-mono text-[12px] tabular-nums ${
                        overTime ? "text-primary" : "text-muted"
                      }`}
                      title="Time on this step / suggested time"
                    >
                      <Clock className="h-3.5 w-3.5" />
                      {fmt(elapsed)} / {step.minutes}:00
                    </span>
                    <div className="ml-auto flex gap-2">
                      {retrying ? (
                        <button
                          type="button"
                          onClick={() => {
                            setRetrying(false);
                            setTab("feedback");
                          }}
                          className="rounded-md border border-line px-3 py-2 text-[13px] text-body transition-colors hover:border-line-strong hover:text-ink"
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={skip}
                          className="rounded-md border border-line px-3 py-2 text-[13px] text-body transition-colors hover:border-line-strong hover:text-ink"
                        >
                          {isLast ? "Skip & finish" : "Skip"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={getFeedback}
                        disabled={status.kind === "loading"}
                        className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-bg transition-colors hover:bg-primary-hover disabled:opacity-70"
                      >
                        {status.kind === "loading" ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reviewing…
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-3.5 w-3.5" /> Get feedback
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  {status.kind === "notice" && (
                    <p
                      role="status"
                      className="mt-3 rounded-md border border-line bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed text-body"
                    >
                      {status.message}
                    </p>
                  )}
                  {status.kind === "error" && (
                    <div
                      role="alert"
                      className="mt-3 rounded-md border border-bad/30 bg-bad/5 px-3.5 py-2.5 text-[13px] leading-relaxed text-body"
                    >
                      {status.message}
                      {(status.unavailable || status.quota) && (
                        <>
                          {" "}
                          <button
                            type="button"
                            onClick={() => setShowSample(true)}
                            className="font-medium text-primary underline underline-offset-2"
                          >
                            Compare with the sample answer
                          </button>{" "}
                          in the meantime.
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ---------- Tabs ---------- */}
              <div className="mt-7 rounded-lg border border-line bg-surface">
                <div className="flex gap-5 border-b border-line px-5" role="tablist">
                  {tabs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === t.id}
                      onClick={() => setTab(t.id)}
                      className={`relative py-3 text-[13px] transition-colors ${
                        activeTab === t.id ? "text-ink" : "text-muted hover:text-ink"
                      }`}
                    >
                      {t.label}
                      {activeTab === t.id && <span className="absolute inset-x-0 -bottom-px h-[2px] bg-primary" />}
                    </button>
                  ))}
                </div>
                <div className="px-5 py-5">
                  {activeTab === "how" && (
                    <div className="text-[14px] leading-relaxed text-body">
                      <p>{guide.intro}</p>
                      <ul className="mt-4 space-y-4">
                        <li className="flex gap-3">
                          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                          <span>
                            <span className="font-medium text-ink">Spend about {step.minutes} minutes</span>
                            <br />
                            That&apos;s a realistic budget for this part of a 45-minute interview.
                          </span>
                        </li>
                        {guide.tips.map((t) => (
                          <li key={t.title} className="flex gap-3">
                            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                            <span>
                              <span className="font-medium text-ink">{t.title}</span>
                              <br />
                              {t.text}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-5 text-[13px] text-muted">
                        Stuck?{" "}
                        <button
                          type="button"
                          onClick={() => setShowSample(true)}
                          className="text-primary underline underline-offset-2"
                        >
                          View the sample answer
                        </button>
                      </p>
                    </div>
                  )}

                  {activeTab === "answer" && (
                    <div className="text-[14px] leading-relaxed text-body">
                      <Quote className="h-5 w-5 text-faint" />
                      {record.answer.trim() ? (
                        <p className="mt-2 whitespace-pre-wrap italic">{record.answer}</p>
                      ) : (
                        <p className="mt-2 text-muted">No written answer.</p>
                      )}
                      {record.boardText?.trim() && (
                        <>
                          <p className="label-caps mt-5">On the board</p>
                          <pre className="mt-2 font-mono text-[12.5px] whitespace-pre-wrap text-body">
                            {record.boardText}
                          </pre>
                        </>
                      )}
                    </div>
                  )}

                  {activeTab === "feedback" && record.feedback && (
                    <>
                      <FeedbackCard
                        feedback={record.feedback}
                        imageReviewed={record.imageReviewed}
                        attempts={record.attempts}
                        model={record.model}
                      />
                      <button
                        type="button"
                        onClick={() => setShowSample(true)}
                        className="mt-7 w-full rounded-md border border-line py-2 text-[13px] text-body transition-colors hover:border-primary hover:text-primary"
                      >
                        View sample answer
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {!editing && (
              <div className="flex items-center gap-3 border-t border-line px-6 py-3.5">
                <button
                  type="button"
                  onClick={() => {
                    setRetrying(true);
                    setStatus({ kind: "idle" });
                    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="rounded-md border border-line px-4 py-2 text-[13px] text-body transition-colors hover:border-line-strong hover:text-ink"
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={advance}
                  className="flex-1 rounded-md bg-ink py-2 text-[13px] font-medium text-bg transition-opacity hover:opacity-90"
                >
                  {isLast ? "Finish session" : "Next question →"}
                </button>
              </div>
            )}
          </>
        )}
      </aside>

      {/* ---------- Whiteboard ---------- */}
      <main className="relative h-[80vh] min-w-0 shrink-0 border-t border-line lg:h-full lg:flex-1 lg:shrink lg:border-t-0">
        <PracticeCanvas
          slug={slug}
          title={title}
          summary={summary}
          activeFrame={step.frame}
          onReady={onCanvasReady}
        />
      </main>

      {showSample && (
        <SampleAnswerDialog question={step.question} empty={emptySamples[current]} onClose={() => setShowSample(false)}>
          {samples[current]}
        </SampleAnswerDialog>
      )}
    </div>
  );
}
