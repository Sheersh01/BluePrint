import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(process.cwd(), "src", "content", "diagrams");

/**
 * Reads the hand-drawn SVG diagrams for an article so they can be inlined (keeps the Virgil font working).
 * A missing file is skipped (logged) rather than breaking the whole page.
 */
export async function loadDiagrams(slug: string, files: Iterable<string>) {
  const entries = await Promise.all(
    [...files].map(async (file) => {
      try {
        const svg = await readFile(path.join(ROOT, slug, path.basename(file)), "utf8");
        return [file, svg] as const;
      } catch {
        console.warn(`[diagrams] missing ${slug}/${file}`);
        return [file, ""] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as Record<string, string>;
}
