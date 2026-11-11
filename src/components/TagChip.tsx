import Link from "next/link";
import { TAG_GROUP_LABEL, tagHref, type Tag } from "@/content/tags";

const STYLE: Record<Tag["group"], string> = {
  // domain: the "what is it" tag — filled, so it reads first
  domain: "border-transparent bg-primary-soft text-primary hover:border-primary",
  // topic: the technical ideas
  topic: "border-line text-body hover:border-primary hover:text-primary",
  // pattern: links the problem to a pattern write-up
  pattern: "border-dashed border-line-strong text-body hover:border-primary hover:text-primary",
};

export function TagChip({ tag, count, size = "md" }: { tag: Tag; count?: number; size?: "sm" | "md" }) {
  return (
    <Link
      href={tagHref(tag.id)}
      title={`${TAG_GROUP_LABEL[tag.group]}: ${tag.description}`}
      className={`inline-flex items-center gap-1.5 rounded-[3px] border transition-colors ${STYLE[tag.group]} ${
        size === "sm" ? "px-1.5 py-px text-[11.5px]" : "px-2 py-0.5 text-[12px]"
      }`}
    >
      {tag.label}
      {count !== undefined && <span className="font-mono text-[10.5px] opacity-70">{count}</span>}
    </Link>
  );
}

/** Legend for the three tag styles. */
export function TagLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-[2px] bg-primary-soft" /> Domain — what it is
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-[2px] border border-line" /> Topic — key ideas
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-[2px] border border-dashed border-line-strong" /> Pattern
      </span>
    </p>
  );
}
