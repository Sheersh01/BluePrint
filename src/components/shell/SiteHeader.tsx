"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { navigation, hrefFor } from "@/content/navigation";
import { useClientValue } from "@/lib/useClientValue";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

/** Full-width header shared by the home page and the reader. */
export function SiteHeader({ onMenu, onSearch }: { onMenu?: () => void; onSearch?: () => void }) {
  const pathname = usePathname();
  const isMac = useClientValue(() => /Mac|iPhone|iPad/.test(navigator.platform), true);
  const activeSection = pathname.split("/")[3];

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg">
      <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
        {onMenu && (
          <button
            onClick={onMenu}
            aria-label="Open contents"
            className="-ml-1 rounded-md p-1.5 text-ink hover:bg-surface-hover lg:hidden"
          >
            <Menu className="h-5 w-5" strokeWidth={1.75} />
          </button>
        )}
        <Logo />

        {/* Tabs start at lg, where they fit; below that, reader pages have the drawer and the home page links from its hero. */}
        <nav
          className="ml-6 hidden items-center gap-6 lg:flex"
          aria-label="Sections"
        >
          {navigation.map((s) => {
            const active = activeSection === s.section;
            return (
              <Link
                key={s.section}
                href={hrefFor(s.section, s.items[0].slug)}
                className={`relative text-[14px] transition-colors ${
                  active ? "text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {s.navLabel ?? s.title}
                {active && <span className="absolute inset-x-0 -bottom-[18px] h-[2px] bg-primary" />}
              </Link>
            );
          })}
          <Link
            href="/practice"
            className={`relative text-[14px] transition-colors ${
              pathname.startsWith("/practice") ? "text-ink" : "text-muted hover:text-ink"
            }`}
          >
            Practice
            {pathname.startsWith("/practice") && <span className="absolute inset-x-0 -bottom-[18px] h-[2px] bg-primary" />}
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {onSearch && (
            <button
              onClick={onSearch}
              aria-label="Search"
              className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[13px] text-muted transition-colors hover:border-line-strong hover:text-ink sm:w-56 lg:w-auto xl:w-56"
            >
              <Search className="h-3.5 w-3.5" strokeWidth={2} />
              {/* Icon-only at lg, where the section tabs need the room */}
              <span className="hidden flex-1 text-left sm:inline lg:hidden xl:inline">Search the library</span>
              <kbd className="hidden rounded border border-line px-1 font-mono text-[10px] text-faint sm:inline lg:hidden xl:inline">
                {isMac ? "⌘K" : "Ctrl K"}
              </kbd>
            </button>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
