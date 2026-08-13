/**
 * The verdict's choreography, as data.
 *
 * ## Why the timeline is a list and not a function full of awaits
 *
 * The arena's own page runs this as a long async function — `await d(520)`,
 * mutate, `await d(300)`, mutate. That is readable and it is untestable: the
 * only way to assert the order is to run it and wait nine seconds.
 *
 * So the same choreography is a **list of steps**, each carrying how long it
 * holds the screen, what it does to the frame, and which sound it triggers. The
 * component walks the list; `test/match-play.test.ts` walks it too, instantly,
 * and can assert that the medallion never lands before both reels have locked —
 * the one ordering that would show a result before its reason.
 *
 * ## Every number here is presentation
 *
 * The delays, the reel durations, the pitch of a tick — none of them are game
 * rules and none are derived from one. What comes from the arena is *what*
 * happened: which action each side played, who took each exchange, who won. The
 * order of reveal is this file's business; the content of the reveal is never
 * its business.
 */

import type { Exchange } from "./match-view";

export type Side = "CHALLENGER" | "THRONE";

/** What a reel is doing. `target` is an index into that fighter's own menu. */
export interface ReelState {
  spinning: boolean;
  /** Bumped per spin so the component can restart a CSS animation. */
  key: number;
  seconds: number;
  target: number;
  locked: boolean;
  fate: "won" | "lost" | null;
}

export interface Frame {
  label: string;
  matchPoint: boolean;
  /** The fighters have entered. Drives the arrival transition. */
  entered: boolean;
  lunge: boolean;
  /** 0, or the 1-based exchange whose impact is landing. */
  impact: number;
  crests: Record<Side, "won" | "lost" | null>;
  reels: Record<Side, ReelState>;
  medallion: { kind: "idle" | "spinning" | "landed"; role: string | null };
  /** One entry per exchange: null, "active", or the side that took it. */
  pips: (string | null)[];
  score: Record<Side, number>;
  /** The verdict banner. Withheld until every coin has landed. */
  banner: boolean;
}

export type Cue =
  | { sound: "swish" }
  | { sound: "clash" }
  | { sound: "drum" }
  | { sound: "tick"; frequency: number }
  | { sound: "action"; type: string }
  | { sound: "reelSpin"; seconds: number }
  | { sound: "coinSpin"; seconds: number }
  | { sound: "coinLand"; role: string }
  | { sound: "finale"; winner: string };

export interface Step {
  /** How long this step holds before the next one runs. */
  hold: number;
  apply: (frame: Frame) => Frame;
  cue?: Cue;
}

function reel(): ReelState {
  return { spinning: false, key: 0, seconds: 0, target: 0, locked: false, fate: null };
}

export function initialFrame(exchanges: readonly Exchange[]): Frame {
  return {
    label: "",
    matchPoint: false,
    entered: false,
    lunge: false,
    impact: 0,
    crests: { CHALLENGER: null, THRONE: null },
    reels: { CHALLENGER: reel(), THRONE: reel() },
    medallion: { kind: "idle", role: null },
    pips: exchanges.map(() => null),
    score: { CHALLENGER: 0, THRONE: 0 },
    banner: false,
  };
}

/**
 * The whole verdict, step by step.
 *
 * `targets` are menu indices — `sequences.<side>.actionIds` — because a reel
 * spins through the fighter's *menu* and stops on the entry that was played. The
 * five resolved actions are not enough to drive it: a reel that only ever showed
 * the five chosen moves would be a carousel of the answer.
 *
 * ## Match point is read, never computed as a rule
 *
 * "Both sides on two" is a fact about the coins already revealed, not a game
 * rule this file knows — it lengthens a pause and adds a drum. If the arena ever
 * changed what a best-of-five means, the worst this does is pace a playback
 * oddly. Nothing here decides an outcome.
 */
export function buildTimeline(
  exchanges: readonly Exchange[],
  targets: { CHALLENGER: number[]; THRONE: number[] },
  winner: string | null,
): Step[] {
  const steps: Step[] = [];
  const total = exchanges.length;
  let spinKey = 0;
  const tally = { CHALLENGER: 0, THRONE: 0 };

  steps.push({ hold: 300, apply: (f) => f });

  for (let i = 0; i < total; i++) {
    const e = exchanges[i];
    const matchPoint = tally.CHALLENGER === 2 && tally.THRONE === 2;
    const stakes = tally.CHALLENGER === 2 || tally.THRONE === 2;

    steps.push({
      hold: 0,
      apply: (f) => ({
        ...f,
        label: `${matchPoint ? "MATCH POINT — " : ""}EXCHANGE ${i + 1} OF ${total}`,
        matchPoint,
        pips: f.pips.map((p, n) => (n === i ? "active" : p)),
      }),
    });

    if (i === 0) steps.push({ hold: 520, apply: (f) => ({ ...f, entered: true }) });

    steps.push({ hold: 300, apply: (f) => ({ ...f, lunge: true }), cue: { sound: "swish" } });
    steps.push({ hold: 180, apply: (f) => ({ ...f, impact: i + 1 }), cue: { sound: "clash" } });
    steps.push({ hold: 280, apply: (f) => ({ ...f, lunge: false }) });

    const challengerKey = ++spinKey;
    const throneKey = ++spinKey;
    steps.push({
      hold: 1300,
      cue: { sound: "reelSpin", seconds: 1.75 },
      apply: (f) => ({
        ...f,
        impact: 0,
        crests: { CHALLENGER: null, THRONE: null },
        medallion: { kind: "idle", role: null },
        reels: {
          // The two reels run for different durations so they land one after the
          // other — the challenger first, which is what makes the throne's stop
          // the beat everyone is waiting for.
          CHALLENGER: {
            spinning: true,
            key: challengerKey,
            seconds: 1.25,
            target: targets.CHALLENGER[i] ?? 0,
            locked: false,
            fate: null,
          },
          THRONE: {
            spinning: true,
            key: throneKey,
            seconds: 1.75,
            target: targets.THRONE[i] ?? 0,
            locked: false,
            fate: null,
          },
        },
      }),
    });

    steps.push({
      hold: 0,
      cue: { sound: "tick", frequency: 900 + 120 * i },
      apply: (f) => ({
        ...f,
        reels: { ...f.reels, CHALLENGER: { ...f.reels.CHALLENGER, spinning: false, locked: true } },
      }),
    });
    steps.push({ hold: 520, apply: (f) => f, cue: { sound: "action", type: e.challenger?.type ?? "" } });

    steps.push({
      hold: 0,
      cue: { sound: "tick", frequency: 1150 + 120 * i },
      apply: (f) => ({
        ...f,
        reels: { ...f.reels, THRONE: { ...f.reels.THRONE, spinning: false, locked: true } },
      }),
    });
    steps.push({
      hold: matchPoint ? 1900 : 500 + (stakes ? 600 : 0),
      apply: (f) => f,
      cue: matchPoint ? { sound: "drum" } : { sound: "action", type: e.throne?.type ?? "" },
    });
    // At match point the drum takes the beat, so the throne's action still has
    // to be voiced — it is not skipped, only reordered behind the drum.
    if (matchPoint) {
      steps.push({ hold: 0, apply: (f) => f, cue: { sound: "action", type: e.throne?.type ?? "" } });
    }

    const spinMs = matchPoint || stakes ? 1300 : 850;
    steps.push({
      hold: spinMs,
      cue: { sound: "coinSpin", seconds: spinMs / 1000 },
      apply: (f) => ({ ...f, medallion: { kind: "spinning", role: null } }),
    });

    const role = e.winnerRole;
    if (role === "CHALLENGER" || role === "THRONE") tally[role] += 1;
    const settled = { ...tally };

    steps.push({
      hold: i < total - 1 ? 1250 : 0,
      cue: role ? { sound: "coinLand", role } : undefined,
      apply: (f) => ({
        ...f,
        medallion: { kind: "landed", role },
        crests: {
          CHALLENGER: role === "CHALLENGER" ? "won" : "lost",
          THRONE: role === "THRONE" ? "won" : "lost",
        },
        reels: {
          CHALLENGER: { ...f.reels.CHALLENGER, fate: role === "CHALLENGER" ? "won" : "lost" },
          THRONE: { ...f.reels.THRONE, fate: role === "THRONE" ? "won" : "lost" },
        },
        pips: f.pips.map((p, n) => (n === i ? role : p)),
        score: settled,
      }),
    });
  }

  const final = { ...tally };
  const loser = winner === "CHALLENGER" ? "THRONE" : "CHALLENGER";
  steps.push({
    hold: 0,
    cue: winner ? { sound: "finale", winner } : undefined,
    apply: (f) => ({
      ...f,
      label: winner
        ? `VERDICT · ${final[winner as Side] ?? 0}–${final[loser as Side] ?? 0}`
        : "VERDICT",
      matchPoint: false,
      banner: true,
    }),
  });

  // The 800ms the arena's page waits before the banner, expressed as a hold on
  // the step before it rather than as a bare sleep.
  const beforeBanner = steps[steps.length - 2];
  if (beforeBanner) beforeBanner.hold += 800;

  return steps;
}

/** The frame a finished playback rests on, without running it. */
export function finalFrame(
  exchanges: readonly Exchange[],
  targets: { CHALLENGER: number[]; THRONE: number[] },
  winner: string | null,
): Frame {
  let frame = initialFrame(exchanges);
  for (const step of buildTimeline(exchanges, targets, winner)) frame = step.apply(frame);
  return { ...frame, entered: true };
}
