"use client";

import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";

/** Very small highlighter tuned for the pseudo-code / HTTP snippets used in breakdowns. */
const COMMENT = "text-[var(--tok-comment)] italic";
const RULES: [RegExp, string][] = [
  [/^"(?:[^"\\]|\\.)*"(?=\s*:)/, "text-[var(--tok-key)]"],
  [/^"(?:[^"\\]|\\.)*"/, "text-[var(--tok-string)]"],
  [/^\b(GET|POST|PUT|PATCH|DELETE|HTTP\/1\.1|Location)\b/, "text-[var(--tok-keyword)] font-semibold"],
  [/^\b\d[\d,.]*\b/, "text-[var(--tok-number)]"],
  [/^->/, "text-[var(--tok-comment)]"],
];

function highlight(full: string, li: number): ReactNode[] {
  // Whole-line comments, or a trailing " # comment"
  if (/^\s*(\/\/|#)/.test(full)) return [<span key={li} className={COMMENT}>{full}</span>];
  const hashAt = full.indexOf(" # ");
  if (hashAt > 0) {
    return [
      ...highlight(full.slice(0, hashAt + 1), li),
      <span key={`${li}-c`} className={COMMENT}>
        {full.slice(hashAt + 1)}
      </span>,
    ];
  }
  const line = full;
  const out: ReactNode[] = [];
  let rest = line;
  let buf = "";
  let k = 0;
  const flush = () => {
    if (buf) out.push(buf);
    buf = "";
  };
  while (rest.length) {
    let matched = false;
    // only start a token at a word boundary
    const prev = line[line.length - rest.length - 1];
    if (!prev || /[\s{}[\](),:=*/+-]/.test(prev)) {
      for (const [re, cls] of RULES) {
        const m = rest.match(re);
        if (m) {
          flush();
          out.push(
            <span key={`${li}-${k++}`} className={cls}>
              {m[0]}
            </span>,
          );
          rest = rest.slice(m[0].length);
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      buf += rest[0];
      rest = rest.slice(1);
    }
  }
  flush();
  return out;
}

export function CodeBlock({ code, title }: { code: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className="group relative my-7 overflow-hidden rounded-[5px] border border-line bg-code">
      {title && <div className="border-b border-line px-4 py-2 text-xs font-medium text-muted">{title}</div>}
      <button
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy code"}
        className="absolute top-2 right-2 rounded-[4px] p-1.5 text-faint opacity-0 transition hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre className="thin-scroll overflow-x-auto px-5 py-4 pr-12 font-mono text-[13px] leading-[1.7] text-ink">
        <code>
          {code.split("\n").map((line, i) => (
            <div key={i}>{line ? highlight(line, i) : " "}</div>
          ))}
        </code>
      </pre>
    </div>
  );
}
