import { describe, expect, it } from "vitest";
import { buildTimeline, finalFrame, initialFrame, type Frame } from "@/lib/match-play";
import type { Exchange } from "@/lib/match-view";

/**
 * The choreography, asserted rather than watched.
 *
 * This is the whole reason `match-play.ts` is a list of steps instead of a
 * function full of awaits: the arena's own page runs this as nine seconds of
 * `await d(520)`, and the only way to check the order there is to sit through
 * it. Here the ordering is data, so the one property that actually matters —
 * **a coin never lands before both reels have locked** — is a loop.
 */

const roles = ["THRONE", "CHALLENGER", "THRONE", "CHALLENGER", "THRONE"];

const exchanges: Exchange[] = roles.map((winnerRole, index) => ({
  index,
  challenger: { id: `c${index}`, text: `challenger ${index}`, type: "strike" },
  throne: { id: `t${index}`, text: `throne ${index}`, type: "bind" },
  winnerRole,
  oneLine: `coin ${index}`,
}));

const targets = { CHALLENGER: [1, 2, 3, 4, 5], THRONE: [5, 4, 3, 2, 1] };

function run(): { frames: Frame[]; cues: string[] } {
  let frame = initialFrame(exchanges);
  const frames: Frame[] = [];
  const cues: string[] = [];
  for (const step of buildTimeline(exchanges, targets, "THRONE")) {
    frame = step.apply(frame);
    frames.push(frame);
    if (step.cue) cues.push(step.cue.sound);
  }
  return { frames, cues };
}

describe("the reveal never gets ahead of itself", () => {
  /**
   * The one ordering that would spoil a verdict: a medallion landing while a
   * reel is still spinning shows who took the exchange before showing what was
   * played for it.
   */
  it("never lands a medallion while either reel is still spinning", () => {
    for (const f of run().frames) {
      if (f.medallion.kind === "landed") {
        expect(f.reels.CHALLENGER.spinning).toBe(false);
        expect(f.reels.THRONE.spinning).toBe(false);
      }
    }
  });

  it("locks the challenger's reel before the throne's", () => {
    const frames = run().frames;
    const challengerLocked = frames.findIndex((f) => f.reels.CHALLENGER.locked);
    const throneLocked = frames.findIndex((f) => f.reels.THRONE.locked);
    expect(challengerLocked).toBeGreaterThan(-1);
    expect(challengerLocked).toBeLessThan(throneLocked);
  });

  /** The banner is the spoiler. It must not appear until every coin has landed. */
  it("withholds the verdict banner until the last coin", () => {
    for (const f of run().frames) {
      if (f.banner) expect(f.pips.every((p) => p !== null && p !== "active")).toBe(true);
    }
  });

  it("reveals the pips in order and never un-reveals one", () => {
    let seen = 0;
    for (const f of run().frames) {
      const settled = f.pips.filter((p) => p !== null && p !== "active").length;
      expect(settled).toBeGreaterThanOrEqual(seen);
      seen = settled;
    }
    expect(seen).toBe(exchanges.length);
  });
});

describe("the score is the arena's decisions, counted in reveal order", () => {
  it("finishes on the published split", () => {
    const last = run().frames.at(-1)!;
    expect(last.score.THRONE).toBe(3);
    expect(last.score.CHALLENGER).toBe(2);
  });

  it("never runs ahead of the coins that have landed", () => {
    for (const f of run().frames) {
      const settled = f.pips.filter((p) => p !== null && p !== "active").length;
      expect(f.score.CHALLENGER + f.score.THRONE).toBe(settled);
    }
  });
});

describe("the cues match the beats", () => {
  it("plays a lunge, a clash, a reel and a coin for every exchange", () => {
    const { cues } = run();
    for (const sound of ["swish", "clash", "reelSpin", "coinSpin", "coinLand"]) {
      expect(cues.filter((c) => c === sound)).toHaveLength(exchanges.length);
    }
  });

  it("ends on the finale, once", () => {
    const { cues } = run();
    expect(cues.filter((c) => c === "finale")).toHaveLength(1);
    expect(cues.at(-1)).toBe("finale");
  });

  /**
   * Match point is a pacing decision, not a game rule — it lengthens a pause and
   * adds a drum. This fixture reaches 2–2 after four exchanges, so the fifth is
   * one; a run that never reaches it must not produce a drum at all.
   */
  it("drums only at match point", () => {
    expect(run().cues.filter((c) => c === "drum")).toHaveLength(1);

    const oneSided: Exchange[] = exchanges.map((e) => ({ ...e, winnerRole: "THRONE" }));
    let frame = initialFrame(oneSided);
    const cues: string[] = [];
    for (const step of buildTimeline(oneSided, targets, "THRONE")) {
      frame = step.apply(frame);
      if (step.cue) cues.push(step.cue.sound);
    }
    expect(cues.filter((c) => c === "drum")).toHaveLength(0);
  });
});

describe("finalFrame is where a playback comes to rest", () => {
  it("matches the last frame of a full run", () => {
    const last = run().frames.at(-1)!;
    const rested = finalFrame(exchanges, targets, "THRONE");
    expect(rested.score).toEqual(last.score);
    expect(rested.pips).toEqual(last.pips);
    expect(rested.banner).toBe(true);
  });

  it("shows the whole board without running anything", () => {
    const rested = finalFrame(exchanges, targets, "THRONE");
    expect(rested.entered).toBe(true);
    expect(rested.reels.CHALLENGER.spinning).toBe(false);
    expect(rested.reels.THRONE.spinning).toBe(false);
  });

  it("survives a match with no verdict", () => {
    const blank = initialFrame(exchanges);
    expect(blank.banner).toBe(false);
    expect(blank.pips.every((p) => p === null)).toBe(true);
    expect(blank.score).toEqual({ CHALLENGER: 0, THRONE: 0 });
  });
});
