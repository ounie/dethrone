import { describe, expect, it } from "vitest";
import { stakeToCents } from "@/lib/stake";

/**
 * The one place this console does arithmetic on money, so it gets the
 * arithmetic tests the rest of the codebase does not need.
 *
 * The cases are grouped by what a failure would MEAN rather than by input
 * shape, because the two directions are not equally bad: a value that comes out
 * too low costs a refusal the operator sees, and a value that comes out too
 * high silently widens the ceiling that `pay.ts`'s offer gate enforces.
 */

describe("what the arena actually writes", () => {
  it("reads a two-decimal stake exactly", () => {
    // The shape every duel listing uses. If only one case in this file survives,
    // it should be this one.
    expect(stakeToCents("1.00")).toBe(100);
    expect(stakeToCents("0.50")).toBe(50);
    expect(stakeToCents("10.25")).toBe(1025);
    expect(stakeToCents("100.00")).toBe(10000);
  });

  it("tolerates the surrounding whitespace of a copied value", () => {
    expect(stakeToCents(" 1.00 ")).toBe(100);
  });
});

describe("the shapes that must not be rounded into a ceiling", () => {
  it("refuses sub-cent precision rather than rounding it", () => {
    /*
      `stakeMicro` is `"1.000000"` on the duel detail read, and it is one
      autocomplete away from being passed here instead of `stakeUsdc`. Six
      decimals cannot become cents without a rounding rule, and a rounding rule
      about money is a rule this console does not get to invent — so this
      refuses, prefills nothing, and leaves a blank field the operator can see.
    */
    expect(stakeToCents("1.000000")).toBeNull();
    expect(stakeToCents("1.005")).toBeNull();
  });

  it("refuses anything that is not a plain decimal number", () => {
    // Currency-marked, signed, exponential, separated, empty. All of them are
    // things some other system writes, and none of them are things this one has
    // been shown.
    for (const bad of ["", "  ", "$1.00", "1.00 USDC", "-1.00", "1e2", "1,000.00", "abc", "1."]) {
      expect(stakeToCents(bad), `accepted ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it("refuses a whole part long enough to threaten the arithmetic", () => {
    expect(stakeToCents("1234567890123.00")).toBeNull();
  });
});

describe("the float bugs this exists to avoid", () => {
  it("never goes through a fractional multiply", () => {
    /*
      `0.07 * 100` is `7.000000000000001` and `Math.round` hides it — until the
      day it does not. `1.10 * 100` is `110.00000000000001`. These pass here
      because the digit groups are parsed as integers and never scaled, and they
      are the cases that would fail the moment someone "simplifies" this to a
      parseFloat.
    */
    expect(stakeToCents("0.07")).toBe(7);
    expect(stakeToCents("1.10")).toBe(110);
    expect(stakeToCents("0.29")).toBe(29);
    expect(stakeToCents("8.15")).toBe(815);
  });

  it("pads a single decimal place rather than scaling it", () => {
    // "1.5" is a hundred and fifty cents, not a hundred and five. The pad is on
    // the digit string; getting this wrong is a silent factor-of-ten error in
    // the dangerous direction for anything above one decimal.
    expect(stakeToCents("1.5")).toBe(150);
    expect(stakeToCents("0.5")).toBe(50);
  });

  it("reads a bare integer as whole units", () => {
    expect(stakeToCents("1")).toBe(100);
    expect(stakeToCents("0")).toBe(0);
  });
});

describe("every accepted value is a usable ceiling", () => {
  it("returns a safe non-negative integer or nothing at all", () => {
    for (const input of ["1.00", "0.01", "0", "999999.99", "1.000000", "$5", "x"]) {
      const out = stakeToCents(input);
      if (out === null) continue;
      expect(Number.isSafeInteger(out), `${input} produced ${out}`).toBe(true);
      expect(out, `${input} produced ${out}`).toBeGreaterThanOrEqual(0);
    }
  });
});
