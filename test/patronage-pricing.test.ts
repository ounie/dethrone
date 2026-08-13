import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { SRC, read } from "./graph";
import { COMMANDS, fieldsFor, MAX_FIELD } from "@/lib/commands";
import { ceilingCentsFor } from "@/lib/patronage";

/**
 * Choosing a tier shows its price and fills the ceiling — from the canon.
 *
 * Two rules meet on this one field and pull in opposite directions. The console
 * may not compute money, so the five prices cannot be typed into
 * `commands.ts`; and the form is unusable without them, because an operator
 * cannot name a sensible ceiling for a price nobody has shown them. The
 * resolution is the one `actions.sequenceLength` already uses: **publish the
 * number**, and read it.
 *
 * These cases guard the reading, and the rounding — which is the part that is
 * wrong in a way nobody would suspect.
 */

const PANE = read(join(SRC, "components/command-pane.tsx"));

describe("the ceiling a tier fills", () => {
  /**
   * The one that matters. `pay.ts` compares `maxCents × 10000` against the
   * quote in atomic units, so a ceiling of 40 against the 402,000-micro Coin is
   * `402000 > 400000` — refused, before a signature exists. A form that filled
   * the floor would refuse the very tier it filled from, and the operator would
   * read it as the arena rejecting a correct request.
   */
  it("rounds UP, so a sub-cent tier is not refused by its own ceiling", () => {
    expect(ceilingCentsFor("402000")).toBe(41); // $0.402 — the Coin
    expect(Number(ceilingCentsFor("402000")) * 10_000).toBeGreaterThanOrEqual(402_000);
  });

  it("leaves a whole-cent price exactly on its own boundary", () => {
    expect(ceilingCentsFor("4020000")).toBe(402); // $4.02
    expect(ceilingCentsFor("40200000")).toBe(4_020); // $40.20
    expect(ceilingCentsFor("4020000000")).toBe(402_000); // $4,020
    expect(ceilingCentsFor("40200000000")).toBe(4_020_000); // $40,200
  });

  it("never suggests a ceiling below the price, at any amount", () => {
    for (const micro of ["1", "9999", "10000", "10001", "402000", "40200000000"]) {
      const cents = ceilingCentsFor(micro)!;
      expect(BigInt(cents) * 10_000n, micro).toBeGreaterThanOrEqual(BigInt(micro));
    }
  });

  it("returns null rather than a guess when the canon published nothing usable", () => {
    for (const bad of ["", "0", "-1", "4.02", "abc", "1e6"]) {
      expect(ceilingCentsFor(bad), bad).toBeNull();
    }
  });

  it("does the arithmetic in bigint, not through a double", () => {
    const source = read(join(SRC, "lib/patronage.ts"));
    expect(source).toContain("BigInt(");
    expect(source).not.toMatch(/Math\.(ceil|round|floor)/);
    expect(source).not.toMatch(/\/\s*1e4|\/\s*10000\b(?!n)/);
  });
});

describe("the catalogue declares the field, and prices nothing", () => {
  const pledge = COMMANDS.find((c) => c.id === "patronage_pledge")!;

  it("uses the patronTier kind and still carries a ceiling field", () => {
    const tier = fieldsFor(pledge).find((f) => f.name === "tier")!;
    expect(tier.kind).toBe("patronTier");
    expect(pledge.maxField).toBe(true);
    expect(fieldsFor(pledge).some((f) => f.name === MAX_FIELD.name)).toBe(true);
  });

  /**
   * The names are a vocabulary and are safe to hold; the prices are a rule and
   * are not. A price appearing beside these options would be the second copy of
   * arena data this whole arrangement exists to avoid.
   */
  it("names the tiers as a fallback without pricing them", () => {
    const tier = fieldsFor(pledge).find((f) => f.name === "tier")!;
    expect(tier.options).toEqual(["coin", "torch", "herald", "benefactor", "founder"]);
    for (const option of tier.options ?? []) {
      expect(option).not.toMatch(/\d/);
      expect(option).not.toContain("$");
    }
  });
});

describe("the pane reads the price rather than deriving one", () => {
  it("fills the ceiling field by name when a tier is chosen", () => {
    expect(PANE).toContain("ceilingCentsFor");
    expect(PANE).toContain("onArg(MAX_FIELD.name");
  });

  /**
   * With the rules read unavailable the picker still names the tiers and shows
   * no price. A fallback price would be a guess, and a guess about money is the
   * one thing this file is not allowed to make.
   */
  it("falls back to the catalogue's names when the canon published nothing", () => {
    expect(PANE).toContain("patronTiers.length > 0");
    expect(PANE).toContain("field.options ?? []");
  });

  it("renders the arena's own price string, never a computed one", () => {
    expect(PANE).toContain("chosenTier.priceLabel");
    // No division, multiplication or unit maths on a price anywhere in the pane.
    expect(PANE).not.toMatch(/priceMicro\s*[/*]/);
    expect(PANE).not.toMatch(/Number\(\s*\w*[Pp]riceMicro/);
  });
});
