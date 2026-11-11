import type { Block, ListItem } from "@/content/types";
import { stripInline } from "@/content/registry";

function listText(items: ListItem[], ordered: boolean | undefined, depth: number, start = 1): string[] {
  const pad = "  ".repeat(depth);
  return items.flatMap((it, i) => {
    const bullet = ordered ? `${start + i}.` : "-";
    if (typeof it === "string") return [`${pad}${bullet} ${stripInline(it)}`];
    return [
      `${pad}${bullet} ${stripInline(it.text)}`,
      ...(it.children ? listText(it.children, it.ordered, depth + 1) : []),
    ];
  });
}

/** Flattens article blocks into plain text (used as the grader's reference answer). */
export function blocksToPlainText(blocks: Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
        out.push(`\n${b.level === 2 ? "##" : "###"} ${stripInline(b.text)}`);
        break;
      case "paragraph":
      case "label":
        out.push(stripInline(b.text));
        break;
      case "list":
        out.push(listText(b.items, b.ordered, 0, b.start).join("\n"));
        break;
      case "callout":
        out.push(`[${b.variant}] ${blocksToPlainText(b.blocks)}`);
        break;
      case "definition":
        out.push(`${stripInline(b.title)}: ${stripInline(b.text)}`);
        break;
      case "code":
        out.push("```\n" + b.code + "\n```");
        break;
      case "diagram":
        if (b.caption) out.push(`[Diagram: ${stripInline(b.caption)}]`);
        break;
      case "solution":
        out.push(
          `[${b.verdict.toUpperCase()} SOLUTION] ${stripInline(b.title)}`,
          `Approach: ${blocksToPlainText(b.approach)}`,
          `Challenges: ${blocksToPlainText(b.challenges)}`,
        );
        break;
      case "pattern":
        out.push(`${stripInline(b.title)}: ${stripInline(b.text)}`);
        break;
      case "sketch":
        out.push(b.lines.join("\n"));
        break;
      case "table":
        out.push(b.rows.map((r) => r.map(stripInline).join(" | ")).join("\n"));
        break;
      case "qa":
        out.push(`Q: ${stripInline(b.question)}\n${blocksToPlainText(b.blocks)}`);
        break;
      default:
        break;
    }
  }
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
