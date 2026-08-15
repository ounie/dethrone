/**
 * The life bars — the arena's own display arithmetic, ported.
 *
 * ## Why this module is allowed to do arithmetic at all
 *
 * `match-view.ts`'s rule stands: a console that recomputes a game outcome is a
 * second implementation of the game. This module computes NO outcome. It is a
 * port of the arena's `web/src/lib/game/lifebar.ts` (damage model of
 * 2026-08-14), which the arena itself describes as "presentation only": the
 * coin tally quantizes margins away, so a dead-even sweep and a slaughter both
 * read "5–0", and the bars narrate how hard each mark was won. **HP decides
 * nothing.** Every coin's winner is still the published `marks`; the match
 * winner is still the published verdict; a coin whose stored totals contradict
 * its mark renders from the MARK at minimum weight and is flagged `disputed`,
 * because the bar must never contradict the record it narrates.
 *
 * The arena's HANDOFF names the one hazard of porting: two bars disagreeing
 * about one stored verdict is a support ticket, even though no money is
 * involved. So this is a port of the SEMANTICS, not a new model, and the
 * arena's published goldens (reference damage `29.3/12.1/46.6/1.7/10.3`, wear
 * `9.3/10.8/6.2/8.3/12.4`, winner resting at 53) are pinned in
 * `test/lifebar.test.ts` as the cross-client conformance fixture.
 *
 * The model, in the arena's words:
 *
 * - **The loser's bar empties.** Each coin they lost takes its
 *   margin-proportional share of the whole fall (`weight = margin +
 *   MIN_WEIGHT`, the rounding remainder on their last lost coin), so landing
 *   on exactly zero is a guarantee, not an approximation.
 * - **The winner keeps exactly the aggregate margin.** Their bar wears down
 *   each exchange in proportion to the loser's output, and rests on
 *   `clamp(aggregate gap, 1, 100)` — the same figure the record table's
 *   margin column totals, so bar and footer cannot disagree. The floor of 1
 *   is "won on marks while behind on points"; only a gap of 100+ leaves them
 *   untouched.
 *
 * ## Where the spread comes from
 *
 * The arena derives `spread(k)` from its frozen contest constants. Those
 * constants do not travel — a copy here would drift on the next season
 * boundary — but every stored contest record CARRIES its own inputs
 * (`weights`, `modScale`, `variety`), precisely so history is immune to
 * future constants. Spread is therefore computed from the record itself,
 * which is the same move the arena's own replay makes.
 */

export type LifebarRole = "CHALLENGER" | "THRONE";

/** One side's stored throw plus the record's own carried inputs. Field names
 *  and meanings follow the arena's `LifebarCoin`; the last three exist so the
 *  spread can be derived without a copy of the frozen schedule. */
export interface LifebarCoin {
  /** The kept die per role, as published. */
  roll: Record<LifebarRole, number>;
  /** The judge-derived modifier per role, as published. */
  mod: Record<LifebarRole, number>;
  /** The variety bonus each role actually received this coin (0 on a repeat),
   *  as the arena's own reveal translation carries it. */
  variety: Record<LifebarRole, number>;
  /** The coin's judge-weight vector, off the stored record. */
  weights: { menace: number; originality: number };
  /** The record's own modifier scale. */
  modScale: number;
  /** The record's own first-use bonus (distinct from `variety` above, which
   *  is the bonus as APPLIED per role). */
  varietyBonus: number;
}

export interface LifebarView {
  /** The match LOSER'S fall, per coin: their lost coins divide 100 between
   *  them by margin; zero on the coins they won. Rounded to 0.1. */
  damage: number[];
  /** The match WINNER'S wear, per coin: proportional to the loser's output
   *  that exchange, summing to 100 − final[winner]. Zero everywhere when the
   *  aggregate gap is 100+ — an annihilation leaves no wounds. */
  wear: number[];
  /** Coins whose stored totals contradict their mark: minimum weight,
   *  rendered from the mark, noted on the row. */
  disputed: boolean[];
  /** The coin's theoretical range, derived from the record's carried inputs —
   *  shown beside the margin so a reader can weigh one against the other. */
  spreads: number[];
  /** HP after all coins, per side — the loser at exactly 0, the winner at
   *  their margin of victory (floored at 1). */
  final: Record<LifebarRole, number>;
  /** Sum of stored totals per side — a display figure, never a rule. */
  aggregate: Record<LifebarRole, number>;
}

/** Both sides open on a full bar, and the loser's empties completely. */
export const HP_START = 100;
/** The floor on a coin's weight, so a tie-ladder coin (margin 0) still
 *  visibly wounds and an all-tie fight still divides cleanly. */
export const MIN_WEIGHT = 1;
/** What the winner can never fall below — they won; they are standing. */
export const WINNER_FLOOR = 1;

/* The rubric's published bounds, restated as display constants: a d20 shows
   1–20, and the panel scores each axis on the 1–10 band scale. */
const D20_MAX = 20;
const D20_MIN = 1;
const AXIS_MAX = 10;
const AXIS_MIN = 1;

const round1 = (x: number) => Math.round(x * 10) / 10;

/** A throw summed — display arithmetic on the stored record; never a winner. */
export function throwTotal(c: LifebarCoin, role: LifebarRole): number {
  return c.roll[role] + c.mod[role] + c.variety[role];
}

/** The record's own modifier at a uniform axis score. */
function modAt(axis: number, c: LifebarCoin): number {
  return Math.round((axis * c.weights.menace + axis * c.weights.originality) / c.modScale);
}

/** The widest total the coin's carried inputs allow — best die, both axes at
 *  the top of the band, first-use variety. */
export function maxTotalOf(c: LifebarCoin): number {
  return D20_MAX + modAt(AXIS_MAX, c) + c.varietyBonus;
}

/** The narrowest — worst die, both axes at the bottom, no variety. */
export function minTotalOf(c: LifebarCoin): number {
  return D20_MIN + modAt(AXIS_MIN, c);
}

/** Display context only — the damage model divides the fight's REAL margins,
 *  not this ceiling. */
export function spreadOf(c: LifebarCoin): number {
  return maxTotalOf(c) - minTotalOf(c);
}

/**
 * The whole bar, from the stored record. Null when any coin lacks a contest
 * record (a flat pre-contest verdict, or a mixed one) — bars render only over
 * a fully contested verdict, and a partial bar would narrate coins it cannot
 * see. Also null on shapes the arena cannot publish (a loser who lost no
 * coin): this reads foreign JSON, and no bar beats a divided-by-zero one.
 */
export function lifebarOf(
  coins: readonly (LifebarCoin | null)[] | null | undefined,
  marks: readonly LifebarRole[],
  tally: Record<LifebarRole, number>,
): LifebarView | null {
  if (!coins || coins.length === 0 || coins.length !== marks.length) return null;
  if (coins.some((c) => c === null)) return null;

  const winner: LifebarRole = tally.CHALLENGER > tally.THRONE ? "CHALLENGER" : "THRONE";
  const matchLoser: LifebarRole = winner === "CHALLENGER" ? "THRONE" : "CHALLENGER";

  const aggregate: Record<LifebarRole, number> = { CHALLENGER: 0, THRONE: 0 };
  const weights: number[] = [];
  const disputed: boolean[] = [];

  for (let k = 0; k < marks.length; k++) {
    const c = coins[k]!;
    const coinWinner = marks[k];
    const coinLoser: LifebarRole = coinWinner === "CHALLENGER" ? "THRONE" : "CHALLENGER";
    aggregate.CHALLENGER += throwTotal(c, "CHALLENGER");
    aggregate.THRONE += throwTotal(c, "THRONE");

    // The record is normative: a mark whose winner is BEHIND on the stored
    // totals is a corrupted pairing. Render from the mark, minimum weight only.
    const gap = throwTotal(c, coinWinner) - throwTotal(c, coinLoser);
    const bad = gap < 0;
    disputed.push(bad);
    weights.push(bad ? MIN_WEIGHT : Math.abs(gap) + MIN_WEIGHT);
  }

  /* The loser's fall is divided among the coins they lost, so their bar lands
     on exactly zero: rate = 100 points over the sum of those weights. The
     last of their lost coins takes the rounding remainder — a guarantee, not
     an approximation. */
  const loserCoinIdx = marks.flatMap((m, k) => (m === winner ? [k] : []));
  if (loserCoinIdx.length === 0) return null;
  const loserWeightSum = loserCoinIdx.reduce((s, k) => s + weights[k], 0);
  const rate = HP_START / loserWeightSum;
  const lastLoserCoin = loserCoinIdx[loserCoinIdx.length - 1];

  const damage: number[] = [];
  let loserDealt = 0;
  for (let k = 0; k < marks.length; k++) {
    if (marks[k] !== winner) {
      damage.push(0);
      continue;
    }
    const dealt =
      k === lastLoserCoin ? round1(HP_START - loserDealt) : round1(rate * weights[k]);
    loserDealt = round1(loserDealt + dealt);
    damage.push(dealt);
  }

  /* The winner's wear: whatever the aggregate margin does NOT cover, spread
     across the coins in proportion to the loser's output each exchange —
     their strongest coins are where the winner bled. The final coin takes the
     rounding remainder, so the resting bar IS the margin, exactly. */
  const gap = aggregate[winner] - aggregate[matchLoser];
  const winnerFinal = Math.min(HP_START, Math.max(WINNER_FLOOR, round1(gap)));
  const wearTotal = round1(HP_START - winnerFinal);
  const loserOutSum = aggregate[matchLoser];
  const wear: number[] = [];
  let wearDealt = 0;
  for (let k = 0; k < marks.length; k++) {
    const share =
      k === marks.length - 1
        ? round1(wearTotal - wearDealt)
        : round1((wearTotal * throwTotal(coins[k]!, matchLoser)) / loserOutSum);
    wearDealt = round1(wearDealt + share);
    wear.push(share);
  }

  const final: Record<LifebarRole, number> = { CHALLENGER: 0, THRONE: 0 };
  final[winner] = winnerFinal;

  return {
    damage,
    wear,
    disputed,
    spreads: coins.map((c) => spreadOf(c!)),
    final,
    aggregate,
  };
}
