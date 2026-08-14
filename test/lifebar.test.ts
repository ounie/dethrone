import { describe, expect, it } from "vitest";
import {
  HP_START,
  MIN_WEIGHT,
  WINNER_FLOOR,
  lifebarOf,
  maxTotalOf,
  minTotalOf,
  spreadOf,
  type LifebarCoin,
  type LifebarRole,
} from "@/lib/lifebar";

/**
 * The cross-client conformance fixture.
 *
 * These are the arena's own goldens (`web/src/lib/game/lifebar.test.ts`),
 * verbatim: the reference match, the rout, the all-tie 3–2, the winner behind
 * on aggregate, and the §7.1 dispute. The arena's HANDOFF names them as the
 * conformance fixture for exactly this port — two bars disagreeing about one
 * stored verdict is a support ticket — so every expected number below is
 * copied from the arena's suite, never re-derived here. If one of these cases
 * fails after an arena upgrade, the port has drifted; port the semantics
 * again, do not adjust the expectation.
 *
 * The one deliberate departure: the arena derives spreads from its frozen
 * contest constants; this port derives them from the record's own carried
 * inputs. The `contest-v1` inputs below (`rotate-5` schedule, modScale 0.5,
 * variety 1) must therefore reproduce the arena's pinned spreads exactly.
 */

/** The `contest-v1` per-coin weight schedule, as every stored record of that
 *  version carries it — fixture data, not a copy of the arena's constant. */
const CONTEST_V1: { weights: { menace: number; originality: number }; modScale: number; varietyBonus: number }[] = [
  { weights: { menace: 1, originality: 3 }, modScale: 0.5, varietyBonus: 1 },
  { weights: { menace: 3, originality: 1 }, modScale: 0.5, varietyBonus: 1 },
  { weights: { menace: 1, originality: 2 }, modScale: 0.5, varietyBonus: 1 },
  { weights: { menace: 2, originality: 1 }, modScale: 0.5, varietyBonus: 1 },
  { weights: { menace: 2, originality: 3 }, modScale: 0.5, varietyBonus: 1 },
];

const coin = (k: number, c: number, t: number, cv = 1, tv = 1): LifebarCoin => ({
  // A throw is die + judges + variety; the module only ever sums them, so the
  // fixtures put the margin wherever is convenient and carry variety honestly.
  roll: { CHALLENGER: 0, THRONE: 0 },
  mod: { CHALLENGER: c - cv, THRONE: t - tv },
  variety: { CHALLENGER: cv, THRONE: tv },
  ...CONTEST_V1[k],
});

/** The arena's reference match — the stored record of the shipped 5–0 whose
 *  margins the tally erased. */
const REFERENCE: LifebarCoin[] = [
  { roll: { CHALLENGER: 11, THRONE: 7 }, mod: { CHALLENGER: 50, THRONE: 70 }, variety: { CHALLENGER: 1, THRONE: 1 }, ...CONTEST_V1[0] },
  { roll: { CHALLENGER: 17, THRONE: 11 }, mod: { CHALLENGER: 54, THRONE: 66 }, variety: { CHALLENGER: 1, THRONE: 1 }, ...CONTEST_V1[1] },
  { roll: { CHALLENGER: 2, THRONE: 14 }, mod: { CHALLENGER: 38, THRONE: 52 }, variety: { CHALLENGER: 1, THRONE: 1 }, ...CONTEST_V1[2] },
  { roll: { CHALLENGER: 14, THRONE: 4 }, mod: { CHALLENGER: 40, THRONE: 50 }, variety: { CHALLENGER: 1, THRONE: 1 }, ...CONTEST_V1[3] },
  { roll: { CHALLENGER: 18, THRONE: 2 }, mod: { CHALLENGER: 64, THRONE: 86 }, variety: { CHALLENGER: 1, THRONE: 0 }, ...CONTEST_V1[4] },
];

const SWEEP_MARKS: LifebarRole[] = ["THRONE", "THRONE", "THRONE", "THRONE", "THRONE"];
const SWEEP_TALLY = { CHALLENGER: 0, THRONE: 5 };

describe("spread — derived from the record's own carried inputs", () => {
  it("reproduces the arena's pinned contest-v1 values", () => {
    expect(REFERENCE.map(spreadOf)).toEqual([92, 92, 74, 74, 110]);
  });

  it("is maxTotal − minTotal off the same inputs", () => {
    for (const c of REFERENCE) {
      expect(spreadOf(c)).toBe(maxTotalOf(c) - minTotalOf(c));
      expect(minTotalOf(c)).toBeGreaterThan(0);
    }
  });
});

describe("the reference match (drain-to-zero model)", () => {
  it("divides the whole fall across the challenger's lost coins, by margin", () => {
    const view = lifebarOf(REFERENCE, SWEEP_MARKS, SWEEP_TALLY);
    expect(view).not.toBeNull();
    expect(view!.damage).toEqual([29.3, 12.1, 46.6, 1.7, 10.3]);
    expect(view!.damage.reduce((a, b) => a + b, 0)).toBeCloseTo(HP_START, 5);
    expect(view!.disputed).toEqual([false, false, false, false, false]);
    expect(view!.final.CHALLENGER).toBe(0);
  });

  it("leaves the winner at exactly the aggregate margin — 366−313 = 53", () => {
    const view = lifebarOf(REFERENCE, SWEEP_MARKS, SWEEP_TALLY)!;
    expect(view.final.THRONE).toBe(53);
    expect(view.wear).toEqual([9.3, 10.8, 6.2, 8.3, 12.4]);
    expect(view.wear.reduce((a, b) => a + b, 0)).toBeCloseTo(HP_START - 53, 5);
  });

  it("sums the aggregate as a display figure", () => {
    const view = lifebarOf(REFERENCE, SWEEP_MARKS, SWEEP_TALLY)!;
    expect(view.aggregate).toEqual({ CHALLENGER: 313, THRONE: 366 });
  });
});

describe("the arena's fixtures", () => {
  it("max rout — a 100+ aggregate gap is an annihilation: no wear at all", () => {
    const marks = Array<LifebarRole>(5).fill("THRONE");
    const coins = marks.map((_, k) => coin(k, minTotalOf(coin(k, 1, 1)), maxTotalOf(coin(k, 1, 1))));
    const view = lifebarOf(coins, marks, SWEEP_TALLY)!;
    expect(view.damage).toEqual([20.8, 20.8, 16.8, 16.8, 24.8]);
    expect(view.wear).toEqual([0, 0, 0, 0, 0]);
    expect(view.final.CHALLENGER).toBe(0);
    expect(view.final.THRONE).toBe(100);
  });

  it("all ties, 3–2 — dead even on points: the winner ends at the floor", () => {
    const marks: LifebarRole[] = ["THRONE", "CHALLENGER", "THRONE", "CHALLENGER", "THRONE"];
    const coins = marks.map((_, k) => coin(k, 60, 60));
    const view = lifebarOf(coins, marks, { CHALLENGER: 2, THRONE: 3 })!;
    expect(view.damage).toEqual([33.3, 0, 33.3, 0, 33.4]);
    expect(view.wear).toEqual([19.8, 19.8, 19.8, 19.8, 19.8]);
    expect(view.final.CHALLENGER).toBe(0);
    expect(view.final.THRONE).toBe(WINNER_FLOOR);
  });

  it("a winner BEHIND on aggregate still stands at the floor", () => {
    const marks: LifebarRole[] = ["THRONE", "CHALLENGER", "THRONE", "CHALLENGER", "THRONE"];
    const coins = marks.map((m, k) => (m === "THRONE" ? coin(k, 60, 60) : coin(k, 110, 60)));
    const view = lifebarOf(coins, marks, { CHALLENGER: 2, THRONE: 3 })!;
    expect(view.final.CHALLENGER).toBe(0);
    expect(view.final.THRONE).toBe(WINNER_FLOOR);
    expect(view.wear.reduce((a, b) => a + b, 0)).toBeCloseTo(HP_START - WINNER_FLOOR, 5);
  });

  it("marks disagreement — renders from the mark, minimum weight, flagged", () => {
    const marks = Array<LifebarRole>(5).fill("THRONE");
    const coins = marks.map((_, k) => (k === 2 ? coin(k, 90, 40) : coin(k, 40, 60)));
    const view = lifebarOf(coins, marks, SWEEP_TALLY)!;
    expect(view.disputed).toEqual([false, false, true, false, false]);
    expect(view.damage).toEqual([24.7, 24.7, 1.2, 24.7, 24.7]);
    expect(view.final.CHALLENGER).toBe(0);
    // aggregate 280 v 250 → the winner rests at the 30-point margin
    expect(view.final.THRONE).toBe(30);
    expect(view.wear).toEqual([11.2, 11.2, 25.2, 11.2, 11.2]);
  });

  it("returns null when any coin lacks a contest record — no partial bars", () => {
    const marks = Array<LifebarRole>(5).fill("THRONE");
    const coins: (LifebarCoin | null)[] = marks.map((_, k) => coin(k, 40, 60));
    coins[3] = null;
    expect(lifebarOf(coins, marks, SWEEP_TALLY)).toBeNull();
    expect(lifebarOf(null, marks, SWEEP_TALLY)).toBeNull();
    expect(lifebarOf([], marks, SWEEP_TALLY)).toBeNull();
  });

  it("returns null on a body whose loser lost no coin — foreign JSON, no bar", () => {
    // The arena's majorities make this unpublishable; this reader still must
    // not divide by zero on a body it did not write.
    const marks: LifebarRole[] = ["CHALLENGER", "CHALLENGER", "CHALLENGER", "CHALLENGER", "CHALLENGER"];
    const coins = marks.map((_, k) => coin(k, 60, 40));
    expect(lifebarOf(coins, marks, { CHALLENGER: 0, THRONE: 5 })).toBeNull();
  });

  it("MIN_WEIGHT is what keeps an all-tie fight divisible", () => {
    expect(MIN_WEIGHT).toBeGreaterThan(0);
  });
});
