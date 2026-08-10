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

/**
 * The same instant, in the reader's own timezone.
 *
 * **Browser only.** On the server there is no reader to be local to, so calling
 * this during a server render would silently format in the deploy's zone —
 * which is why `components/time.tsx` exists and this is not called directly
 * from anything that renders on both sides.
 *
 * Still not relative, and still not a clock: `stamp`'s argument against "3
 * minutes ago" is that it keeps moving while the data does not, and this moves
 * no more than the UTC string it replaces. It is the same instant with a
 * different offset applied.
 *
 * `sv-SE` for the format rather than the language: it is the locale whose short
 * form is already ISO-like (`2026-08-10 16:48:21`), so the shape an operator
 * has been reading survives the change of zone. Falls back to the raw stamp if
 * the runtime cannot do it.
 */
export function localStamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(at);
  } catch {
    return stamp(iso);
  }
}

/**
 * A short name for the reader's zone, so a localised time is never ambiguous.
 *
 * The SHORT form — `PDT`, `GMT+2` — and not the IANA name. The first draft
 * rendered `America/Los_Angeles` beside every timestamp, which is nineteen
 * characters of qualifier next to eight characters of value, on rows narrow
 * enough that it pushed the time itself out of alignment.
 *
 * Abbreviations do collide (CST is three different offsets), which is why the
 * full IANA name and the original UTC string both survive in the `title` of
 * `components/time.tsx` — the precise answer is one hover away, and the row
 * stays readable.
 */
export function zoneLabel(): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(
      new Date(),
    );
    const zone = parts.find((p) => p.type === "timeZoneName")?.value;
    return zone || Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  } catch {
    return "local";
  }
}

/** The full IANA name, for a tooltip. Precise where the badge is short. */
export function zoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  } catch {
    return "local";
  }
}

/** Local wall-clock for the session log. Session state, not canon state. */
export function logTime(date: Date): string {
  return date.toISOString().slice(11, 19);
}
