"use client";

import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
};
const noopSubscribe = () => () => {};

/** A localStorage-backed string that is SSR-safe (server snapshot = fallback). */
export function useStoredValue(key: string, fallback: string) {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key) ?? fallback;
      } catch {
        return fallback;
      }
    },
    () => fallback,
  );
  const set = (v: string) => {
    try {
      localStorage.setItem(key, v);
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  };
  return [value, set] as const;
}

/** Reads a browser-only value without a hydration mismatch. */
export function useClientValue<T>(get: () => T, serverValue: T) {
  return useSyncExternalStore(noopSubscribe, get, () => serverValue);
}
