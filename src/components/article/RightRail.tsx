"use client";

import { useEffect, useState } from "react";
import type { TocItem } from "@/content/types";
import { getScroller, markCompleted } from "@/lib/progress";

/**
 * Article chrome driven by the reading column's scroll position:
 * a hairline progress bar under the header, and the "Contents" rail.
 */
export function ReadingChrome({ toc, pageHref }: { toc: TocItem[]; pageHref: string }) {
  const { progress, active } = useScrollSpy(toc);

  useEffect(() => {
    if (progress >= 0.98) markCompleted(pageHref);
  }, [progress, pageHref]);

  const activeParent = toc.find((t) => t.id === active || t.children.some((c) => c.id === active))?.id;

  return (
    <>
      <div
        className="pointer-events-none fixed top-14 right-0 left-0 z-30 h-[2px] lg:left-64"
        role="progressbar"
        aria-label="Reading progress"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${progress * 100}%` }} />
      </div>

      <aside className="hidden w-60 shrink-0 xl:block">
        <nav aria-label="Contents" className="thin-scroll sticky top-10 max-h-[calc(100dvh-120px)] overflow-y-auto pr-2 pb-6">
          <p className="label-caps mb-4 flex items-baseline justify-between">
            Contents
            <span className="font-mono text-[10px] font-normal tracking-normal text-faint">{Math.round(progress * 100)}%</span>
          </p>
          <ul className="border-l border-line">
            {toc.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className={`relative -ml-px block border-l py-1 pl-4 text-[13px] leading-snug transition-colors ${
                    activeParent === item.id
                      ? "border-primary font-medium text-ink"
                      : "border-transparent text-body hover:text-ink"
                  }`}
                >
                  {item.label}
                </a>
                {item.children.length > 0 && (
                  <ul className="mb-1.5">
                    {item.children.map((c) => (
                      <li key={c.id}>
                        <a
                          href={`#${c.id}`}
                          title={c.label}
                          className={`block truncate py-[3px] pl-7 text-[12px] leading-snug transition-colors ${
                            active === c.id ? "text-primary" : "text-muted hover:text-ink"
                          }`}
                        >
                          {c.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </>
  );
}

/** Tracks scroll position of the main scroll container: reading progress + active heading. */
function useScrollSpy(toc: TocItem[]) {
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState<string | undefined>(toc[0]?.id);

  useEffect(() => {
    const scroller = getScroller();
    if (!scroller) return;
    const ids = toc.flatMap((t) => [t.id, ...t.children.map((c) => c.id)]);
    let frame = 0;

    const update = () => {
      frame = 0;
      const max = scroller.scrollHeight - scroller.clientHeight;
      setProgress(max > 0 ? Math.min(1, scroller.scrollTop / max) : 1);

      const top = scroller.getBoundingClientRect().top;
      let current: string | undefined = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top - top <= 120) current = id;
      }
      if (max - scroller.scrollTop < 4) current = ids.at(-1);
      setActive(current);
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [toc]);

  return { progress, active };
}
