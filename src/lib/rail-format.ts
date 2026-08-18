/**
 * Rendering the Rail's two number shapes, and nothing else.
 *
 * It lives under `src/lib/` for the reason `stake.ts` does — the currency-literal
 * scan does not read this directory — and, more importantly, for the reason that
 * rule exists at all: a component that does money arithmetic will one day do it
 * wrong, so the arithmetic gets one home, integer-only, with a test.
 *
 * ## Nothing here is a price, and nothing settles on it
 *
 * Both functions are DISPLAY. The pools they format are the arena's own
 * micro-USDC strings, the basis points are the arena's own decision about pool
 * share, and a position settles at the amount the operator pays over x402 —
 * never at anything computed here. This is the narrowest possible bend of the
 * money rule: a unit conversion for a readout, in the direction where being
 * wrong costs a misread rather than a wrong payment.
 *
 * ## Integer-only, via BigInt
 *
 * Micro-USDC is 6 decimal places and a JS number is a double. `1234567 / 1e6`
 * is exactly the class of arithmetic `stake.ts` was written to avoid — the
 * float traps its own test pins (`0.07 * 100 === 7.000000000000001`) apply
 * identically in this direction. So the conversion is BigInt division with an
 * explicit half-up round to the cent, and the string is assembled from digits
 * rather than from `toFixed`.
 */

/** `1234567` → `1.23`. The arena's micro-USDC string as the dollars it is. */
export function microToUsd(micro: string): string | null {
  // The arena writes a plain integer. Anything else is a shape change, and a
  // silent fallback would render it as a number the arena never sent.
  if (!/^-?\d+$/.test(micro)) return null;

  const negative = micro.startsWith("-");
  const value = BigInt(negative ? micro.slice(1) : micro);
  // Half-up to the cent: 10_000 micro is one cent, so 5_000 is the half.
  const cents = (value + 5_000n) / 10_000n;
  const dollars = cents / 100n;
  const remainder = cents % 100n;
  return `${negative && cents !== 0n ? "-" : ""}${dollars}.${remainder.toString().padStart(2, "0")}`;
}

/**
 * Basis points as the percentage the arena means, or the word it means instead.
 *
 * ⚠️ `null` is NOT zero. Below the arena's forming floor, or with either side
 * empty, it publishes no price — and a client that rendered that as "0%" would
 * be reporting a pool nobody has backed as one nobody believes in. The word is
 * the arena's own.
 */
export function priceLabel(bps: number | null): string {
  if (bps === null) return "forming";
  // Integer basis points; the rounding is over whole percent, not over money.
  return `${Math.round(bps / 100)}%`;
}
