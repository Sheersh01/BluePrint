"use client";

import { Moon, Sun } from "lucide-react";

/** Icon swaps purely via the `dark` class, so there is no hydration flash. */
export function ThemeToggle() {
  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-ink"
    >
      <Sun className="h-4 w-4 dark:hidden" strokeWidth={1.75} />
      <Moon className="hidden h-4 w-4 dark:block" strokeWidth={1.75} />
    </button>
  );
}
