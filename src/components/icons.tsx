import type { SVGProps } from "react";

/** Blueprint mark: a drafting frame with a ruled grid and one inked corner. */
export function BlueprintMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <rect x="2.75" y="2.75" width="18.5" height="18.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.75 9h18.5M9 2.75v18.5" stroke="currentColor" strokeWidth="1" opacity="0.55" />
      <rect x="12.5" y="12.5" width="6" height="6" rx="0.75" fill="var(--primary)" />
    </svg>
  );
}
