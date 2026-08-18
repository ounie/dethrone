/**
 * A posted stake, as a ceiling the operator can edit.
 *
 * ## What this is for, and what it is emphatically not
 *
 * The console's second rule is that a UI which computes money will one day
 * compute it wrong, and this file is the one place that rule is bent. It is
 * worth stating precisely how far, because the distance is small and the
 * temptation to widen it will not be.
 *
 * This does **not** produce a price, and nothing settles on its output. It
 * produces a starting value for the operator's own `maxCents` field — the
 * ceiling that `pay.ts`'s offer gate compares the 402's quote against before
 * anything is signed. The amount actually paid comes from the arena's 402 and
 * from nowhere else, exactly as it did before this file existed.
 *
 * ## Why prefilling is the safer option, not the lazier one
 *
 * The instinct is that a hand-typed ceiling is more careful than a computed
 * one. It is the reverse, and the asymmetry is what decided this: a ceiling
 * that is too LOW costs a refusal, which the operator sees and fixes. A ceiling
 * that is too HIGH silently widens the seatbelt, and that is the direction a
 * human typing digits fails in — a fat-fingered trailing zero on a stake read
 * off the row above accepts a quote ten times the one intended, and looks
 * exactly like a correct entry while doing it.
 *
 * So the arithmetic is here, where it can be pinned by tests, rather than in
 * ten operators' fingers.
 *
 * ## How it refuses
 *
 * Integer arithmetic on matched digit groups. No `parseFloat`, no
 * multiplication of a fractional value, no rounding — `"0.07"` is famously not
 * `0.07`, and a cents conversion that goes through a float is the exact bug
 * this console's rules are written to prevent.
 *
 * Everything it does not recognise EXACTLY returns null, and null prefills
 * nothing. That includes the sub-cent forms: `stakeMicro` arrives as
 * `"1.000000"`, and six decimals cannot become cents without rounding, so this
 * refuses rather than rounds. A blank field is a visible, correctable state; a
 * silently rounded ceiling is not.
 */

/**
 * The arena's decimal string, as an integer number of cents — or null when the
 * string is anything other than a whole number with at most two decimal places.
 *
 * Deliberately narrow. It is fed `stakeUsdc` from a duel listing, which the
 * arena writes as `"1.00"`, and it should keep failing closed on every shape it
 * has not been shown.
 */
export function stakeToCents(usdc: string): number | null {
  // Anchored, and bounded on the whole part so a pathological string cannot
  // reach the arithmetic below. Twelve digits is far beyond any stake the arena
  // publishes and far short of anything that troubles a safe integer.
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(usdc.trim());
  if (!match) return null;

  const whole = Number(match[1]);
  // `padEnd` before `Number`, so "1.5" is fifty cents rather than five. The
  // pad is on the DIGIT STRING and never on the value — scaling a parsed 5 by
  // ten is the same float multiply this file exists to avoid.
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));

  // A hundred here is not a price. It is the number of cents in a unit, which
  // is arithmetic about the denomination and not about what anything costs.
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) ? cents : null;
}
