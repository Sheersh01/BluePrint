"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { SiteHeader } from "./SiteHeader";
import { Sidebar } from "./Sidebar";
import { SearchDialog } from "./SearchDialog";
import { SCROLL_ID } from "@/lib/progress";

/**
 * Reader layout: a full-width header, the library index on the left, and an
 * independently scrolling reading column.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState(false);

  // Close the mobile drawer whenever the route changes.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setDrawer(false);
  }

  // Cmd/Ctrl + K opens search, "/" too when not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input, textarea, [contenteditable]");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <SiteHeader onMenu={() => setDrawer(true)} onSearch={() => setSearch(true)} />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 border-r border-line lg:block">
          <Sidebar />
        </aside>

        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="animate-fade-in absolute inset-0 bg-ink/25" onClick={() => setDrawer(false)} />
            <aside className="animate-pop-in absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-bg">
              <Sidebar onClose={() => setDrawer(false)} />
            </aside>
          </div>
        )}

        <div id={SCROLL_ID} className="thin-scroll relative min-w-0 flex-1 overflow-y-auto scroll-smooth">
          {children}
        </div>
      </div>
      {search && <SearchDialog onClose={() => setSearch(false)} />}
    </div>
  );
}
