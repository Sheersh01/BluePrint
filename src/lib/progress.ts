"use client";

import { useEffect, useState } from "react";

const KEY = "hi:completed";
const EVENT = "hi:completed-change";

function read(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function markCompleted(href: string) {
  try {
    const list = read();
    if (list.includes(href)) return;
    localStorage.setItem(KEY, JSON.stringify([...list, href]));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* storage unavailable */
  }
}

/** Pages the reader has scrolled to the end of (stored per-browser). */
export function useCompleted() {
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => setDone(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return done;
}

/** The app uses an inner scroll container (like the reference site) rather than the window. */
export const SCROLL_ID = "main-scroll";
export const getScroller = () => document.getElementById(SCROLL_ID);
