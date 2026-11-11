import type { ReactNode } from "react";

const STYLES = {
  tip: { label: "Note", rule: "border-primary", text: "text-primary" },
  info: { label: "Aside", rule: "border-info", text: "text-info" },
  warning: { label: "Caution", rule: "border-bad", text: "text-bad" },
} as const;

/** Margin note: a ruled left edge and a small-caps label, no boxes or icons. */
export function Callout({
  variant,
  title,
  children,
}: {
  variant: keyof typeof STYLES;
  /** Overrides the default label (e.g. "Interviewer asks") */
  title?: string;
  children: ReactNode;
}) {
  const s = STYLES[variant];
  return (
    <aside className={`my-7 border-l-2 pl-5 ${s.rule}`}>
      <p className={`label-caps mb-1.5 !text-[10px] ${s.text}`}>{title ?? s.label}</p>
      <div className="hi-flow text-[16px] leading-[1.7] text-body">{children}</div>
    </aside>
  );
}
