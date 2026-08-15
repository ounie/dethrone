import { describe, expect, it } from "vitest";
import { clock, readMatch, secondsUntil, tallyAfter } from "@/lib/match-view";

/**
 * The match reader, as a table.
 *
 * The property this file exists to protect is the one `CLAUDE.md` opens with: a
 * UI that branches on game state is a second implementation of the game. So the
 * cases below are mostly about what the reader *declines* to work out — the
 * winner of an exchange, the tally, the verdict — and about the one number it is
 * allowed to produce agreeing with the arena's at the point anyone would act on
 * it.
 *
 * The fixture is a real `/api/match/:id` body, trimmed. Field names and shapes
 * are the arena's, including the `one_line` snake case that sits beside
 * `oneLine` in the same document — copying that faithfully is the point, since a
 * reader that quietly normalised it would pass its own tests and render nothing.
 */

const BODY = {
  matchId: "mat_WWV0N8SPQDED8EFWP4GD0S",
  mode: "throne",
  arena: "gladiator-sands",
  ruleset: "prompt-duel-v1",
  queueState: "resolved",
  startedAt: null,
  endedAt: "2026-08-12T00:31:45.520Z",
  throne: {
    name: "Thugesh the Undrowned",
    characterId: 294,
    imageUrl: "https://example.invalid/throne.png",
    houseSlug: "ash-stadium",
    dq: false,
    dqReason: null,
  },
  challenger: {
    name: "Rynenra the Unkept",
    characterId: 296,
    imageUrl: "https://example.invalid/challenger.png",
    houseSlug: "orbital-ring",
    dq: false,
    dqReason: null,
  },
  verdict: {
    winner: "THRONE",
    tally: { CHALLENGER: 0, THRONE: 5 },
    marks: ["THRONE", "THRONE", "THRONE", "THRONE", "THRONE"],
    oneLine: "A chilling herald of winter, wielding the bell of doom!",
    judgeModel: "google/gemini-2.5-flash-lite",
    rubricVersion: "rubric-v4",
    coins: [0, 1, 2, 3, 4].map((index) => ({
      index,
      // `A`/`B` is a per-coin permutation the judges were shown. It exists so
      // the panel cannot be biased by order, and resolving it here would be
      // reimplementing it — `winnerRole` is the arena having already done so.
      permutation: { A: "CHALLENGER", B: "THRONE" },
      winner: "B",
      winnerRole: "THRONE",
      scores: { fighter_A: { menace: 8 }, fighter_B: { menace: 9 } },
      one_line: `coin ${index}`,
    })),
  },
  sequences: {
    challenger: {
      source: "drawn",
      actionIds: [3, 13, 12, 12, 14],
      actions: [
        { id: "staff:3", text: "a planted vault into a kick", type: "range" },
        { id: "reaching:5", text: "a wide flanking stride", type: "range" },
        { id: "reaching:4", text: "an over-the-guard reach", type: "strike" },
        { id: "reaching:4", text: "an over-the-guard reach", type: "strike" },
        { id: "reaching:6", text: "a pulling redirect", type: "bind" },
      ],
    },
    throne: {
      source: "submitted",
      actionIds: [1, 2, 3, 4, 5],
      actions: [
        { id: "haft:1", text: "a strike driven into the ground", type: "feint" },
        { id: "haft:2", text: "an over-the-guard reach", type: "strike" },
        { id: "haft:3", text: "a short jab of the haft's butt", type: "feint" },
        { id: "haft:4", text: "a raking grab at the shoulder", type: "bind" },
        { id: "haft:5", text: "a raking grab at the shoulder", type: "bind" },
      ],
    },
  },
  selection: null,
};

describe("it reads a match, and refuses anything else", () => {
  it("narrows a real body", () => {
    const m = readMatch(BODY)!;
    expect(m.matchId).toBe("mat_WWV0N8SPQDED8EFWP4GD0S");
    expect(m.mode).toBe("throne");
    expect(m.challenger.name).toBe("Rynenra the Unkept");
    expect(m.throne.houseSlug).toBe("ash-stadium");
    expect(m.source).toEqual({ challenger: "drawn", throne: "submitted" });
  });

  it("returns null for something that is not a match", () => {
    // A shape test, not a game rule: it is how the panel tells "you ran
    // something else" from "this match has not been judged yet".
    for (const junk of [null, undefined, 0, "mat_x", [], {}, { seat: true }]) {
      expect(readMatch(junk)).toBeNull();
    }
  });

  it("survives a body with nothing in it but an id", () => {
    const m = readMatch({ matchId: "mat_x" })!;
    expect(m.verdict).toBeNull();
    expect(m.selection).toBeNull();
    expect(m.exchanges).toEqual([]);
    expect(m.challenger.name).toBeNull();
  });
});

describe("it renders decisions rather than making them", () => {
  it("takes the winner of an exchange from winnerRole, never from the scores", () => {
    const m = readMatch(BODY)!;
    expect(m.exchanges.map((e) => e.winnerRole)).toEqual([
      "THRONE",
      "THRONE",
      "THRONE",
      "THRONE",
      "THRONE",
    ]);
  });

  /**
   * The case that would catch the dangerous version. `winner` is `B` — a
   * position in a permutation, not a side. A reader that resolved it would be
   * reimplementing the arena's anti-bias shuffle, and would be wrong the first
   * time a coin's permutation differed.
   */
  it("never resolves the A/B permutation for itself", () => {
    const flipped = {
      ...BODY,
      verdict: {
        ...BODY.verdict,
        coins: [
          {
            ...BODY.verdict.coins[0],
            permutation: { A: "THRONE", B: "CHALLENGER" },
            winner: "B",
            // The arena says CHALLENGER took it, and `winner: "B"` agrees only
            // once the permutation is applied. The reader must report the
            // arena's word regardless.
            winnerRole: "CHALLENGER",
          },
        ],
      },
    };
    expect(readMatch(flipped)!.exchanges[0].winnerRole).toBe("CHALLENGER");
  });

  it("reads the published tally rather than counting one", () => {
    const m = readMatch(BODY)!;
    expect(m.verdict?.tallyChallenger).toBe(0);
    expect(m.verdict?.tallyThrone).toBe(5);
  });

  /**
   * The invariant `tallyAfter`'s comment claims, asserted rather than trusted:
   * the playback's running count and the arena's published tally agree once
   * everything is revealed. If they ever diverge, the published one is right and
   * the playback is the bug — and this is what would say so.
   */
  it("agrees with the arena once every coin is revealed", () => {
    const m = readMatch(BODY)!;
    const counted = tallyAfter(m.exchanges, m.exchanges.length);
    expect(counted.challenger).toBe(m.verdict!.tallyChallenger);
    expect(counted.throne).toBe(m.verdict!.tallyThrone);
  });

  it("counts only what has been revealed, in order", () => {
    const mixed = readMatch({
      ...BODY,
      verdict: {
        ...BODY.verdict,
        coins: ["CHALLENGER", "THRONE", "CHALLENGER", "THRONE", "THRONE"].map((role, index) => ({
          index,
          winnerRole: role,
          one_line: "",
        })),
      },
    })!;
    expect(tallyAfter(mixed.exchanges, 0)).toEqual({ challenger: 0, throne: 0 });
    expect(tallyAfter(mixed.exchanges, 3)).toEqual({ challenger: 2, throne: 1 });
    expect(tallyAfter(mixed.exchanges, 5)).toEqual({ challenger: 2, throne: 3 });
    // Out of range in either direction is clamped, not thrown on.
    expect(tallyAfter(mixed.exchanges, -1)).toEqual({ challenger: 0, throne: 0 });
    expect(tallyAfter(mixed.exchanges, 99)).toEqual({ challenger: 2, throne: 3 });
  });
});

describe("the exchanges pair by position", () => {
  it("puts each side's action beside the coin that judged it", () => {
    const m = readMatch(BODY)!;
    expect(m.exchanges).toHaveLength(5);
    expect(m.exchanges[0].challenger?.text).toBe("a planted vault into a kick");
    expect(m.exchanges[0].challenger?.type).toBe("range");
    expect(m.exchanges[0].throne?.text).toBe("a strike driven into the ground");
    expect(m.exchanges[0].oneLine).toBe("coin 0");
  });

  /**
   * The length comes from the longest array, not from a constant. Five is the
   * arena's number today and it is published as `actions.sequenceLength`; a five
   * hard-coded in the reader would silently truncate the day it versions.
   */
  it("takes its length from the longest array, and renders the hole", () => {
    const ragged = readMatch({
      ...BODY,
      sequences: {
        challenger: { source: "drawn", actions: [BODY.sequences.challenger.actions[0]] },
        throne: BODY.sequences.throne,
      },
    })!;
    expect(ragged.exchanges).toHaveLength(5);
    expect(ragged.exchanges[0].challenger).not.toBeNull();
    expect(ragged.exchanges[1].challenger).toBeNull();
    expect(ragged.exchanges[1].throne).not.toBeNull();
  });

  it("survives a match with a verdict but no sequences published", () => {
    const m = readMatch({ ...BODY, sequences: {} })!;
    expect(m.exchanges).toHaveLength(5);
    expect(m.exchanges.every((e) => e.challenger === null && e.throne === null)).toBe(true);
  });
});

describe("the contest record is translated, never resolved", () => {
  /** A stored `contest-v1` record as the wire carries it — SIDE-keyed, with
   *  the permutation beside it. Field names are the arena's. */
  const CONTEST = {
    v: "contest-v1",
    weights: { menace: 1, originality: 3 },
    modScale: 0.5,
    variety: 1,
    mods: { A: 50, B: 70 },
    advantage: { A: "advantage", B: "disadvantage" },
    dice: { A: [11, 4], B: [7, 12] },
    roll: { A: 11, B: 7 },
    firstUse: { A: true, B: false },
    totals: { A: 62, B: 77 },
    winnerSide: "B",
    tiePath: "none",
    tieBreakRolls: { A: [], B: [] },
    seedRef: "a".repeat(64),
    flourish: { A: false, B: false },
    stumble: { A: false, B: false },
  };

  const withContest = (permutation: { A: string; B: string }) => ({
    ...BODY,
    verdict: {
      ...BODY.verdict,
      coins: [{ ...BODY.verdict.coins[0], permutation, contest: CONTEST }],
    },
  });

  it("keys every field by ROLE through the published permutation", () => {
    const m = readMatch(withContest({ A: "CHALLENGER", B: "THRONE" }))!;
    const c = m.exchanges[0].contest!;
    expect(c.roll).toEqual({ CHALLENGER: 11, THRONE: 7 });
    expect(c.mod).toEqual({ CHALLENGER: 50, THRONE: 70 });
    expect(c.advantage).toEqual({ CHALLENGER: "advantage", THRONE: "disadvantage" });
    expect(c.dice.THRONE).toEqual([7, 12]);
    // The arena's own translation: the record's bonus where firstUse, else 0.
    expect(c.variety).toEqual({ CHALLENGER: 1, THRONE: 0 });
    expect(c.weights).toEqual({ menace: 1, originality: 3 });
    expect(c.modScale).toBe(0.5);
    expect(c.varietyBonus).toBe(1);
  });

  it("follows a flipped permutation instead of assuming A is the challenger", () => {
    const m = readMatch(withContest({ A: "THRONE", B: "CHALLENGER" }))!;
    const c = m.exchanges[0].contest!;
    expect(c.roll).toEqual({ THRONE: 11, CHALLENGER: 7 });
    expect(c.variety).toEqual({ THRONE: 1, CHALLENGER: 0 });
  });

  it("degrades a malformed record to null, whole — never a partial read", () => {
    for (const broken of [
      { ...CONTEST, roll: { A: 11 } },
      { ...CONTEST, mods: { A: "50", B: 70 } },
      { ...CONTEST, tiePath: "declared" },
      null,
      "contest",
    ]) {
      const m = readMatch({
        ...BODY,
        verdict: {
          ...BODY.verdict,
          coins: [{ ...BODY.verdict.coins[0], contest: broken }],
        },
      })!;
      expect(m.exchanges[0].contest).toBeNull();
    }
    // A permutation that does not name both roles is no permutation.
    const m = readMatch(withContest({ A: "CHALLENGER", B: "CHALLENGER" }))!;
    expect(m.exchanges[0].contest).toBeNull();
  });

  it("carries nothing on a pre-contest coin", () => {
    const m = readMatch(BODY)!;
    expect(m.exchanges.every((e) => e.contest === null)).toBe(true);
  });
});

describe("a live selection window", () => {
  it("is read from the arena's answer, never inferred", () => {
    const live = readMatch({
      ...BODY,
      verdict: null,
      selection: {
        closesAt: "2026-08-13T12:00:00.000Z",
        submitted: { challenger: true, throne: false },
      },
    })!;
    expect(live.verdict).toBeNull();
    expect(live.selection).toEqual({
      closesAt: "2026-08-13T12:00:00.000Z",
      submittedChallenger: true,
      submittedThrone: false,
    });
  });
});

describe("the countdown is arithmetic on the arena's own timestamp", () => {
  const closes = "2026-08-13T12:00:00.000Z";
  const at = Date.parse(closes);

  it("counts down in whole seconds", () => {
    expect(secondsUntil(closes, at - 210_000)).toBe(210);
    expect(secondsUntil(closes, at - 1_000)).toBe(1);
  });

  /**
   * Zero, and not negative — and, more importantly, not "closed". Reaching zero
   * here disables nothing and sends nothing; only the arena's next answer closes
   * a window. See the function's own comment.
   */
  it("clamps at zero rather than going negative", () => {
    expect(secondsUntil(closes, at)).toBe(0);
    expect(secondsUntil(closes, at + 60_000)).toBe(0);
  });

  it("returns null when there is nothing to count", () => {
    expect(secondsUntil(null, at)).toBeNull();
    expect(secondsUntil("not a date", at)).toBeNull();
    expect(secondsUntil("", at)).toBeNull();
  });

  it("formats as m:ss", () => {
    expect(clock(210)).toBe("3:30");
    expect(clock(9)).toBe("0:09");
    expect(clock(0)).toBe("0:00");
    expect(clock(600)).toBe("10:00");
  });
});
