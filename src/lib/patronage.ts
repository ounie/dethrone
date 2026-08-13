import type { Rules } from "./rules";

/**
 * What the pledge form needs to know, derived from the canon and nothing else.
 *
 * Client-safe: no key, no network, no `server-only`. It holds arithmetic over
 * numbers the arena published, which is the one kind of money handling this
 * console permits — the rule it must not break is *computing a price*, and
 * nothing here invents one.
 */

export interface PatronTierOption {
  key: string;
  name: string;
  priceMicro: string;
  priceLabel: string;
  cap: number | null;
}

export function patronTierFor(live: Rules, key: string | undefined): PatronTierOption | null {
  if (!key) return null;
  return live.patronage.find((t) => t.key === key) ?? null;
}

/**
 * The smallest whole-cent ceiling that will not refuse this tier's own quote.
 *
 * **Rounds UP, and that is the whole function.** The offer gate in `pay.ts`
 * compares atomic units — `maxCents × 10000` against the quote — so a ceiling
 * of 40 against a 402,000-micro Coin is `402000 > 400000` and the pledge is
 * refused before a signature exists. A form that prefilled the floor would
 * refuse the very tier it prefilled for, and the operator would read it as the
 * arena rejecting a correct request.
 *
 * Integer bigint, because the input is micro-USDC and this console does not put
 * money through a double even to round it.
 */
export function ceilingCentsFor(priceMicro: string): number | null {
  if (!/^\d+$/.test(priceMicro)) return null;
  const micro = BigInt(priceMicro);
  if (micro <= 0n) return null;
  const MICRO_PER_CENT = 10_000n;
  return Number((micro + MICRO_PER_CENT - 1n) / MICRO_PER_CENT);
}

/**
 * Options for the tier picker, in the canon's order.
 *
 * Empty when the arena published nothing — the caller then falls back to the
 * catalogue's static option list, which can still name the tiers even when it
 * cannot price them. Naming is not a rule; pricing is.
 */
export function patronTierOptions(live: Rules): PatronTierOption[] {
  return live.patronage;
}
