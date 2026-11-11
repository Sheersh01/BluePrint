/** The model's free quota (per-minute or per-day) is used up. */
export class QuotaError extends Error {
  constructor(
    message: string,
    /** How long the provider says to wait, if it said */
    public retryAfterMs?: number,
    /** A daily limit (or a model that has no free quota at all) rather than a per-minute one */
    public daily = false,
  ) {
    super(message);
  }
}

/** The provider is temporarily overloaded ("high demand", 5xx, timeout). */
export class BusyError extends Error {}

/** The provider rejected the key or the configuration (bad key, unknown model). */
export class ConfigError extends Error {}

/** The model replied, but not with valid feedback JSON. */
export class BadOutputError extends Error {}

/** Parses durations like "2h52m59.2s", "39s", "1.2s" or "850ms" into milliseconds. */
export function parseDuration(text: string): number | undefined {
  const m = /(?:retry|try again) in\s*((?:\d+h)?(?:\d+m(?!s))?(?:[\d.]+(?:ms|s))?)/i.exec(text);
  if (!m || !m[1]) return undefined;
  let ms = 0;
  for (const [, n, unit] of m[1].matchAll(/([\d.]+)(h|ms|m|s)/g)) {
    const v = Number(n);
    ms += unit === "h" ? v * 3_600_000 : unit === "m" ? v * 60_000 : unit === "s" ? v * 1000 : v;
  }
  return ms > 0 ? Math.ceil(ms) : undefined;
}
