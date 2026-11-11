"use client";

import { ArrowLeft, ArrowRight, Check, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { QuizQuestion } from "@/content/types";

export function Quiz({ questions }: { questions: QuizQuestion[] }) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const [done, setDone] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const q = questions[idx];
  const picked = answers[idx];
  const answered = picked !== null;
  const correctCount = answers.filter((a, i) => a === questions[i].answer).length;

  const pick = useCallback(
    (i: number) => {
      if (answers[idx] !== null) return;
      setAnswers((a) => a.map((v, j) => (j === idx ? i : v)));
    },
    [answers, idx],
  );

  const next = useCallback(() => {
    if (idx < questions.length - 1) setIdx(idx + 1);
    else setDone(true);
  }, [idx, questions.length]);

  // Number keys pick an option, Enter / → moves on — only while the quiz is on screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done || (e.target as HTMLElement)?.closest("input, textarea")) return;
      const r = rootRef.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) return;
      const n = Number(e.key);
      if (n >= 1 && n <= q.options.length) pick(n - 1);
      if ((e.key === "Enter" || e.key === "ArrowRight") && answered) next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answered, done, next, pick, q.options.length]);

  const restart = () => {
    setAnswers(questions.map(() => null));
    setIdx(0);
    setDone(false);
  };


  return (
    <section ref={rootRef} className="mt-20 border-t border-line pt-10" aria-labelledby="quiz-title">
      <p className="label-caps text-primary!">Check yourself</p>
      <h2 id="quiz-title" className="mt-2 font-serif text-[30px] leading-tight font-medium tracking-[-0.02em] text-ink">
        {questions.length} questions on this write-up
      </h2>
      <p className="mt-1 text-[15px] text-muted">Answer from memory — wrong answers point you back to the section to reread.</p>

      <div className="mt-6">
        {done ? (
          <Results questions={questions} answers={answers} correct={correctCount} onRestart={restart} />
        ) : (
          <div>
            <div className="flex items-baseline justify-between font-mono text-[12px] text-muted">
              <span>
                {String(idx + 1).padStart(2, "0")} / {String(questions.length).padStart(2, "0")}
              </span>
              <span className="tabular-nums">{correctCount} correct</span>
            </div>
            <div className="mt-2 h-px bg-line">
              <div
                className="h-px bg-primary transition-all"
                style={{ width: `${((idx + (answered ? 1 : 0)) / questions.length) * 100}%` }}
              />
            </div>

            <p className="mt-6 font-serif text-[22px] leading-snug font-medium text-ink">{q.question}</p>

            <ol className="mt-5 border-t border-line">
              {q.options.map((opt, i) => {
                const isCorrect = i === q.answer;
                const isPicked = i === picked;
                let tone = "text-body hover:bg-surface-hover hover:text-ink";
                if (answered) {
                  if (isCorrect) tone = "text-ink bg-great/10";
                  else if (isPicked) tone = "text-ink bg-bad/10";
                  else tone = "text-faint";
                }
                return (
                  <li key={i} className="border-b border-line">
                    <button
                      type="button"
                      disabled={answered}
                      onClick={() => pick(i)}
                      className={`flex w-full items-center gap-4 px-2 py-3.5 text-left text-[16px] transition-colors disabled:cursor-default ${tone}`}
                    >
                      <span className="w-5 shrink-0 font-mono text-[12px] text-muted">
                        {answered && isCorrect ? (
                          <Check className="h-4 w-4 text-great" strokeWidth={2} />
                        ) : answered && isPicked ? (
                          <X className="h-4 w-4 text-bad" strokeWidth={2} />
                        ) : (
                          String.fromCharCode(97 + i)
                        )}
                      </span>
                      <span>{opt}</span>
                    </button>
                  </li>
                );
              })}
            </ol>

            {answered && (
              <div className={`animate-pop-in mt-5 border-l-2 pl-4 ${picked === q.answer ? "border-great" : "border-bad"}`}>
                <p className={`label-caps !text-[10px] ${picked === q.answer ? "text-great!" : "text-bad!"}`}>
                  {picked === q.answer ? "Correct" : "Not quite"}
                </p>
                <p className="mt-1 text-[15px] leading-relaxed text-body">{q.explanation}</p>
                {picked !== q.answer && q.section && (
                  <a href={`#${q.section}`} className="mt-1.5 inline-block text-[14px] text-primary underline underline-offset-4">
                    Reread this section
                  </a>
                )}
              </div>
            )}

            <div className="mt-7 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIdx((i) => Math.max(0, i - 1))}
                disabled={idx === 0}
                className="inline-flex items-center gap-1.5 text-[14px] text-muted transition-colors hover:text-ink disabled:opacity-30"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={1.75} /> Previous
              </button>
              <button
                type="button"
                onClick={next}
                disabled={!answered}
                className="inline-flex items-center gap-1.5 rounded-[4px] bg-ink px-4 py-2 text-[14px] font-medium text-bg transition-colors hover:bg-primary disabled:opacity-30"
              >
                {idx === questions.length - 1 ? "See results" : "Next"} <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Results({
  questions,
  answers,
  correct,
  onRestart,
}: {
  questions: QuizQuestion[];
  answers: (number | null)[];
  correct: number;
  onRestart: () => void;
}) {
  const missed = questions.map((q, i) => ({ q, i })).filter(({ q, i }) => answers[i] !== q.answer);
  return (
    <div>
      <p className="font-serif text-[44px] leading-none font-medium text-ink">
        {correct}
        <span className="text-muted">/{questions.length}</span>
      </p>
      <p className="mt-2 text-[15px] text-body">
        {missed.length === 0 ? "No gaps. You know this one." : "Worth rereading before your interview:"}
      </p>
      {missed.length > 0 && (
        <ul className="mt-4 border-t border-line">
          {missed.map(({ q, i }) => (
            <li key={i} className="flex items-baseline justify-between gap-4 border-b border-line py-3 text-[15px]">
              <span className="text-ink">{q.question}</span>
              {q.section && (
                <a href={`#${q.section}`} className="shrink-0 text-[14px] text-primary underline underline-offset-4">
                  Reread
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <button
        onClick={onRestart}
        className="mt-6 inline-flex items-center gap-2 text-[14px] text-muted transition-colors hover:text-ink"
      >
        <RotateCcw className="h-4 w-4" strokeWidth={1.75} /> Start again
      </button>
    </div>
  );
}
