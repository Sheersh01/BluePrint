import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Inline } from "@/lib/inline";

/** "Related pattern" aside that links into the Patterns section. */
export function PatternCard({ title, text, href }: { title: string; text: string; href: string }) {
  const name = title.replace(/^Pattern:\s*/, "");
  return (
    <aside className="my-8 rounded-[5px] border border-line bg-surface-muted/60 px-5 py-4">
      <p className="label-caps !text-[10px]">Related pattern</p>
      <Link
        href={href}
        className="group mt-1 inline-flex items-center gap-1 font-serif text-[20px] font-medium text-ink transition-colors hover:text-primary"
      >
        {name}
        <ArrowUpRight className="h-4 w-4 text-muted transition-colors group-hover:text-primary" strokeWidth={1.75} />
      </Link>
      <p className="mt-1.5 text-[15px] leading-[1.65] text-body">
        <Inline text={text} />
      </p>
    </aside>
  );
}
