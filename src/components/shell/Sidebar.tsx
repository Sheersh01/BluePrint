"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, PenLine, Tags, X } from "lucide-react";
import { navigation, hrefFor } from "@/content/navigation";
import { useCompleted } from "@/lib/progress";
import { Logo } from "./Logo";

function sectionForPath(pathname: string) {
  return navigation.find((sec) =>
    sec.items.some((item) => hrefFor(sec.section, item.slug) === pathname),
  )?.section;
}

/** The library index: collapsible sections, every article listed. */
export function Sidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const completed = useCompleted();
  const activeRef = useRef<HTMLAnchorElement>(null);
  const activeSection = useMemo(() => sectionForPath(pathname), [pathname]);

  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const initial = activeSection ?? navigation[0]?.section;
    return Object.fromEntries(navigation.map((sec) => [sec.section, sec.section === initial]));
  });

  // Keep the section that owns the current page expanded when navigating.
  // Adjusted during render when the section changes (React's pattern for this), not in an effect.
  const [lastActive, setLastActive] = useState(activeSection);
  if (activeSection !== lastActive) {
    setLastActive(activeSection);
    if (activeSection && !open[activeSection]) setOpen({ ...open, [activeSection]: true });
  }

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [pathname]);

  const toggle = (section: string) => {
    setOpen((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="flex h-full flex-col">
      {onClose && (
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
          <Logo />
          <button onClick={onClose} aria-label="Close contents" className="rounded-md p-1.5 text-muted hover:bg-surface-hover">
            <X className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
      )}
      <nav className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 pt-6 pb-10" aria-label="Library">
        {/* The header tabs are hidden on small screens, so the drawer also links to Practice. */}
        <Link
          href="/practice"
          onClick={onClose}
          className={`mb-1 flex items-center gap-2 rounded-[4px] px-3 py-2 text-[14px] transition-colors lg:hidden ${
            pathname.startsWith("/practice") ? "bg-surface-muted text-ink" : "text-body hover:bg-surface-hover hover:text-ink"
          }`}
        >
          <PenLine className="h-3.5 w-3.5" strokeWidth={2} />
          Practice on a whiteboard
        </Link>
        <Link
          href="/tags"
          onClick={onClose}
          className={`mb-4 flex items-center gap-2 rounded-[4px] px-3 py-2 text-[14px] transition-colors ${
            pathname.startsWith("/tags") ? "bg-surface-muted text-ink" : "text-body hover:bg-surface-hover hover:text-ink"
          }`}
        >
          <Tags className="h-3.5 w-3.5" strokeWidth={2} />
          Browse problems by tag
        </Link>
        {navigation.map((sec) => {
          const expanded = !!open[sec.section];
          const panelId = `nav-${sec.section}`;
          return (
            <section key={sec.section} className="mb-2 last:mb-0">
              <button
                type="button"
                onClick={() => toggle(sec.section)}
                aria-expanded={expanded}
                aria-controls={panelId}
                className="label-caps flex w-full items-center gap-2 rounded-[4px] px-3 py-2 text-left transition-colors hover:bg-surface-hover"
              >
                <span className="flex-1">{sec.title}</span>
                <span className="font-mono text-[10px] font-normal tracking-normal text-faint">{sec.items.length}</span>
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
                  strokeWidth={1.75}
                />
              </button>
              {expanded && (
                <ul id={panelId} className="pb-4">
                  {sec.items.map((item) => {
                    const href = hrefFor(sec.section, item.slug);
                    const active = pathname === href;
                    const read = completed.includes(href);
                    return (
                      <li key={item.slug}>
                        <Link
                          ref={active ? activeRef : undefined}
                          href={href}
                          onClick={onClose}
                          aria-current={active ? "page" : undefined}
                          className={`relative flex items-center gap-2 rounded-[4px] py-[5px] pr-2 pl-3 text-[14px] transition-colors ${
                            active ? "bg-surface-muted text-ink" : "text-body hover:bg-surface-hover hover:text-ink"
                          }`}
                        >
                          {active && <span className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-primary" />}
                          <span className="flex-1 truncate">{item.title}</span>
                          {read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" title="Read" />}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </nav>
    </div>
  );
}
