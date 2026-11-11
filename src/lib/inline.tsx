import { Fragment, type ReactNode } from "react";
import Link from "next/link";

/**
 * Renders the tiny inline markdown dialect used by article content:
 *   **bold**  *italic*  __underline__  `code`  [label](url)  {{ABBR|Full meaning}}
 */
const TOKEN =
  /(\*\*(.+?)\*\*)|(__(.+?)__)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))|(\{\{([^|}]+)\|([^}]+)\}\})|(\*([^*\s][^*]*?)\*)/g;

export function Inline({ text }: { text: string }) {
  return <>{parse(text, "k")}</>;
}

function parse(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const key = `${keyPrefix}-${i++}`;
    if (m[1]) out.push(<strong key={key}>{parse(m[2], key)}</strong>);
    else if (m[3]) out.push(<u key={key} className="underline-offset-4">{parse(m[4], key)}</u>);
    else if (m[5]) out.push(<code key={key} className="inline-code">{m[6]}</code>);
    else if (m[7]) {
      const href = m[9];
      const label = parse(m[8], key);
      if (href.startsWith("/")) {
        out.push(
          <Link key={key} href={href} className="inline-link">
            {label}
          </Link>,
        );
      } else {
        out.push(
          <a
            key={key}
            href={href}
            className="inline-link"
            {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer noopener" } : {})}
          >
            {label}
          </a>,
        );
      }
    } else if (m[10]) {
      out.push(
        <abbr key={key} title={m[12]}>
          {m[11]}
        </abbr>,
      );
    } else if (m[13]) out.push(<em key={key}>{parse(m[14], key)}</em>);
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.map((n, j) => (typeof n === "string" ? <Fragment key={`${keyPrefix}-t${j}`}>{n}</Fragment> : n));
}
