/**
 * Formatting. Not arithmetic.
 *
 * Every number that reaches these functions came from the arena or from the
 * operator's own configuration. Nothing here decides what an amount *is* — it
 * decides how it is spelled. That distinction is what lets
 * `test/currency-literals.test.ts` refuse a currency literal anywhere under
 * `src/app/` and `src/components/` with an empty allowlist: the UI can render
 * money because it never computes any.
 *
 * Client-safe. No secrets, no imports.
 */

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Cents → "$1.00". The cents came from `GET /api/rules` or from a 402. */
export function money(cents: number): string {
  return USD.format(cents / 100);
}

/**
 * A percentage for a meter, clamped to [0, 100].
 *
 * Clamped because the ceiling is a local seatbelt and not an authority: a
 * reservation can legitimately sit at the cap, and a bar that renders past its
 * own track reads as a bug rather than as a limit reached.
 */
export function pct(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}

/** `0x8fd379…f7a03` — enough to recognise, short enough to sit in a chip. */
export function shortAddress(address: string): string {
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/**
 * An ISO timestamp as the arena wrote it, trimmed to seconds.
 *
 * Deliberately NOT localised and deliberately not relative. "3 minutes ago" is
 * a clock read, and a clock read is a rule: it would keep changing while the
 * data behind it did not, which is how a stale number starts looking fresh.
 */
export function stamp(iso: string): string {
  return iso.length >= 19 ? `${iso.slice(0, 19).replace("T", " ")}Z` : iso;
}

/** Local wall-clock for the session log. Session state, not canon state. */
export function logTime(date: Date): string {
  return date.toISOString().slice(11, 19);
}
