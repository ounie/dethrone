/**
 * A match body, narrowed to what the playback renders — and nothing computed.
 *
 * ## Why this is a separate, pure module
 *
 * The same split `assertions.ts` makes from `config.ts`, for the same payoff: a
 * pure reader is a table-driven test with no component to mount and no clock to
 * stub. It also keeps the one genuinely dangerous habit in one place — see
 * below.
 *
 * ## It reads. It never decides.
 *
 * `CLAUDE.md`'s first rule is that a UI branching on game state is a second
 * implementation of the game. This module is the boundary that rule is enforced
 * at, so it is worth naming exactly what is and is not happening here.
 *
 * What it does: pick fields out of the arena's answer, pair the two sequences
 * up by index because the arena publishes them as parallel arrays, and report
 * their shape.
 *
 * What it must never start doing: decide who won an exchange, total a tally,
 * infer a winner from the marks, judge whether a window is open, or fill a
 * missing field with a plausible one. Every one of those is published. `winner`,
 * `winnerRole`, `tally`, `marks` and `oneLine` are the arena's own words and are
 * rendered as they arrive — a console that recomputed a tally would eventually
 * disagree with the verdict it is displaying, and the one on this screen would
 * be the wrong one.
 *
 * The tell that this line has been crossed is arithmetic on a score. There is
 * none in this file, and there should never be.
 */

export interface MatchAction {
  id: string;
  text: string;
  /** `strike | guard | bind | feint | range`, as the arena types them. */
  type: string;
}

type ContestRole = "CHALLENGER" | "THRONE";

/**
 * A coin's stored contest record, ROLE-keyed — the evidence the record table
 * and the life bars render.
 *
 * The wire keys these by SIDE (`A`/`B`, the per-coin permutation the judges
 * were shown) and publishes `permutation` beside them for exactly this
 * translation — the arena's own reveal performs the identical mapping
 * server-side (`revealContestsOf`). Mapping a published key through a
 * published map is a read, not a decision: nothing here resolves a winner
 * (`winnerRole` remains the arena's word) and every number is carried as it
 * arrived. `variety` follows the arena's translation too: the record's bonus
 * where `firstUse` is true, zero where it is not.
 *
 * `weights`, `modScale` and `varietyBonus` are the record's own carried
 * inputs, kept so the spread column can derive from the record itself rather
 * than from a copy of the arena's frozen constants.
 */
export interface ExchangeContest {
  roll: Record<ContestRole, number>;
  dice: Record<ContestRole, number[]>;
  mod: Record<ContestRole, number>;
  variety: Record<ContestRole, number>;
  advantage: Record<ContestRole, "advantage" | "disadvantage" | "none">;
  flourish: Record<ContestRole, boolean>;
  stumble: Record<ContestRole, boolean>;
  tiePath: "none" | "mod" | "seeded";
  tieBreakRolls: Record<ContestRole, number[]>;
  weights: { menace: number; originality: number };
  modScale: number;
  varietyBonus: number;
}

export interface MatchSide {
  name: string | null;
  characterId: number | null;
  imageUrl: string | null;
  houseSlug: string | null;
  dq: boolean;
  dqReason: string | null;
}

/** One exchange: what each side did, and which side the judges gave it to. */
export interface Exchange {
  index: number;
  challenger: MatchAction | null;
  throne: MatchAction | null;
  /** `CHALLENGER` or `THRONE`, exactly as published. Never derived from scores. */
  winnerRole: string | null;
  /** The judge's sentence for this coin. */
  oneLine: string | null;
  /** The coin's contest record, when the verdict carries one. Null degrades
   *  the evidence panel, never the playback. */
  contest: ExchangeContest | null;
}

export interface MatchView {
  matchId: string | null;
  mode: string | null;
  arena: string | null;
  ruleset: string | null;
  queueState: string | null;
  startedAt: string | null;
  endedAt: string | null;
  throne: MatchSide;
  challenger: MatchSide;
  /**
   * The selection window, when the arena reports one. Its presence is the only
   * signal this console uses that a window exists — never a comparison of
   * `closesAt` against a clock, which would be the window rule reimplemented
   * here.
   */
  selection: { closesAt: string | null; submittedChallenger: boolean; submittedThrone: boolean } | null;
  /** Null until the arena has judged. Its presence is what makes a match playable. */
  verdict: {
    winner: string | null;
    oneLine: string | null;
    rubricVersion: string | null;
    judgeModel: string | null;
    tallyChallenger: number | null;
    tallyThrone: number | null;
    marks: string[];
  } | null;
  exchanges: Exchange[];
  /** How each side's sequence arrived: `drawn`, `submitted`, `preset`… */
  source: { challenger: string | null; throne: string | null };
  /**
   * The MENU INDICES each side played, per exchange.
   *
   * Kept alongside the resolved actions because the reel needs them: it spins
   * through the fighter's whole menu and stops on the entry that was played, and
   * an index is the only thing that says *where in that menu* to stop. The five
   * resolved actions cannot drive it — a reel showing only the five chosen moves
   * would be a carousel of the answer.
   */
  actionIds: { CHALLENGER: number[]; THRONE: number[] };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Menu indices, filtered to the whole non-negative numbers an index can be. */
function indices(raw: unknown): number[] {
  return Array.isArray(raw)
    ? raw.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0)
    : [];
}

function side(raw: unknown): MatchSide {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    name: str(o.name),
    characterId: num(o.characterId),
    imageUrl: str(o.imageUrl),
    houseSlug: str(o.houseSlug),
    dq: o.dq === true,
    dqReason: str(o.dqReason),
  };
}

function action(raw: unknown): MatchAction | null {
  const o = raw as Record<string, unknown> | undefined;
  const text = str(o?.text);
  if (!text) return null;
  return { id: str(o?.id) ?? "", text, type: str(o?.type) ?? "" };
}

/**
 * Narrow one coin's `contest` through its `permutation`, or null.
 *
 * All-or-nothing on purpose: a record with one malformed field renders as no
 * record, because a partially-read throw would put a plausible wrong number in
 * an official-looking table — the same "a blank is silent while a plausible
 * wrong value is a claim" rule the fighter identity read already follows.
 */
function contestOf(raw: unknown, permRaw: unknown): ExchangeContest | null {
  const c = raw as Record<string, unknown> | null | undefined;
  const p = permRaw as Record<string, unknown> | null | undefined;
  if (!c || typeof c !== "object" || !p) return null;
  const roleA = p.A;
  const roleB = p.B;
  const isRole = (v: unknown): v is ContestRole => v === "CHALLENGER" || v === "THRONE";
  if (!isRole(roleA) || !isRole(roleB) || roleA === roleB) return null;

  const byRole = <T>(field: unknown, read: (v: unknown) => T | null): Record<ContestRole, T> | null => {
    const o = field as Record<string, unknown> | null | undefined;
    if (!o || typeof o !== "object") return null;
    const a = read(o.A);
    const b = read(o.B);
    if (a === null || b === null) return null;
    return { [roleA]: a, [roleB]: b } as Record<ContestRole, T>;
  };
  const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
  const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
  const ints = (v: unknown): number[] | null =>
    Array.isArray(v) && v.every((n) => typeof n === "number" && Number.isInteger(n)) ? (v as number[]) : null;

  const roll = byRole(c.roll, int);
  const dice = byRole(c.dice, ints);
  const mod = byRole(c.mods, int);
  const firstUse = byRole(c.firstUse, bool);
  const advantage = byRole(c.advantage, (v) =>
    v === "advantage" || v === "disadvantage" || v === "none" ? v : null,
  );
  const flourish = byRole(c.flourish, bool);
  const stumble = byRole(c.stumble, bool);
  const tieBreakRolls = byRole(c.tieBreakRolls, ints);
  const tiePath = c.tiePath === "none" || c.tiePath === "mod" || c.tiePath === "seeded" ? c.tiePath : null;
  const w = c.weights as Record<string, unknown> | null | undefined;
  const menace = int(w?.menace);
  const originality = int(w?.originality);
  const modScale = typeof c.modScale === "number" && c.modScale > 0 ? c.modScale : null;
  const varietyBonus = int(c.variety);

  if (
    !roll || !dice || !mod || !firstUse || !advantage || !flourish || !stumble ||
    !tieBreakRolls || tiePath === null || menace === null || originality === null ||
    modScale === null || varietyBonus === null
  ) {
    return null;
  }

  return {
    roll,
    dice,
    mod,
    // The arena's own translation: the record's bonus where firstUse, else 0.
    variety: {
      CHALLENGER: firstUse.CHALLENGER ? varietyBonus : 0,
      THRONE: firstUse.THRONE ? varietyBonus : 0,
    },
    advantage,
    flourish,
    stumble,
    tiePath,
    tieBreakRolls,
    weights: { menace, originality },
    modScale,
    varietyBonus,
  };
}

/**
 * Pair the two sequences with the coins, by index.
 *
 * The arena publishes three parallel arrays — `sequences.challenger.actions`,
 * `sequences.throne.actions`, and `verdict.coins` — and the pairing is
 * positional because an exchange IS a position. The length is taken from the
 * longest rather than from a constant: five is the arena's number today, it is
 * published as `actions.sequenceLength`, and a five hard-coded here would
 * silently truncate the day it versions. A row with a hole renders the hole.
 */
function exchanges(body: Record<string, unknown>): Exchange[] {
  const sequences = (body.sequences ?? {}) as Record<string, unknown>;
  const chSeq = (sequences.challenger ?? {}) as Record<string, unknown>;
  const thSeq = (sequences.throne ?? {}) as Record<string, unknown>;
  const chActions = Array.isArray(chSeq.actions) ? chSeq.actions : [];
  const thActions = Array.isArray(thSeq.actions) ? thSeq.actions : [];

  const verdict = (body.verdict ?? {}) as Record<string, unknown>;
  const coins = Array.isArray(verdict.coins) ? verdict.coins : [];

  const length = Math.max(chActions.length, thActions.length, coins.length);
  const out: Exchange[] = [];
  for (let i = 0; i < length; i++) {
    const coin = (coins[i] ?? {}) as Record<string, unknown>;
    out.push({
      index: i,
      challenger: action(chActions[i]),
      throne: action(thActions[i]),
      // `winnerRole`, never `winner`. The latter is `A`/`B` — a position in a
      // per-coin permutation the judges were shown, which exists precisely so
      // the panel cannot be biased by order. Resolving it here would mean
      // reimplementing that permutation, and `winnerRole` is the arena having
      // already done it.
      winnerRole: str(coin.winnerRole),
      oneLine: str(coin.one_line),
      contest: contestOf(coin.contest, coin.permutation),
    });
  }
  return out;
}

/**
 * Narrow a `/api/match/:id` body, or null if it is not one.
 *
 * Returning null for a body with no `matchId` is a shape test, not a game rule:
 * it is how the panel tells "you ran something that is not a match" from "the
 * match has not been judged yet", which are different screens.
 */
export function readMatch(body: unknown): MatchView | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  if (!str(o.matchId)) return null;

  const rawVerdict = o.verdict as Record<string, unknown> | null | undefined;
  const tally = (rawVerdict?.tally ?? {}) as Record<string, unknown>;
  const rawSelection = o.selection as Record<string, unknown> | null | undefined;
  const submitted = (rawSelection?.submitted ?? {}) as Record<string, unknown>;
  const sequences = (o.sequences ?? {}) as Record<string, unknown>;

  return {
    matchId: str(o.matchId),
    mode: str(o.mode),
    arena: str(o.arena),
    ruleset: str(o.ruleset),
    queueState: str(o.queueState),
    startedAt: str(o.startedAt),
    endedAt: str(o.endedAt),
    throne: side(o.throne),
    challenger: side(o.challenger),
    selection: rawSelection
      ? {
          closesAt: str(rawSelection.closesAt),
          submittedChallenger: submitted.challenger === true,
          submittedThrone: submitted.throne === true,
        }
      : null,
    verdict: rawVerdict
      ? {
          winner: str(rawVerdict.winner),
          oneLine: str(rawVerdict.oneLine),
          rubricVersion: str(rawVerdict.rubricVersion),
          judgeModel: str(rawVerdict.judgeModel),
          // Read, not counted. See the module note.
          tallyChallenger: num(tally.CHALLENGER),
          tallyThrone: num(tally.THRONE),
          marks: Array.isArray(rawVerdict.marks)
            ? rawVerdict.marks.filter((m): m is string => typeof m === "string")
            : [],
        }
      : null,
    exchanges: exchanges(o),
    source: {
      challenger: str((sequences.challenger as Record<string, unknown> | undefined)?.source),
      throne: str((sequences.throne as Record<string, unknown> | undefined)?.source),
    },
    actionIds: {
      CHALLENGER: indices((sequences.challenger as Record<string, unknown> | undefined)?.actionIds),
      THRONE: indices((sequences.throne as Record<string, unknown> | undefined)?.actionIds),
    },
  };
}

/**
 * The running tally after `n` exchanges, for the playback only.
 *
 * ⚠️ **This is a rendering of the marks, not a scoring of the match**, and the
 * distinction is the reason this function is allowed to exist at all. It counts
 * `winnerRole` values the arena already decided, over a prefix, so that a
 * half-played verdict can show a score that matches what has been revealed. It
 * never produces the final tally — `verdict.tally` is published and is what the
 * finished state renders, so nothing here can disagree with the arena about who
 * won.
 *
 * If the two ever differ at the end, the published one is right and this is a
 * playback bug. `test/match-view.test.ts` pins that they agree on a real body.
 */
export function tallyAfter(exchanges: readonly Exchange[], revealed: number): {
  challenger: number;
  throne: number;
} {
  let challenger = 0;
  let throne = 0;
  for (const e of exchanges.slice(0, Math.max(0, revealed))) {
    if (e.winnerRole === "CHALLENGER") challenger += 1;
    else if (e.winnerRole === "THRONE") throne += 1;
  }
  return { challenger, throne };
}

/**
 * Time left against a deadline the ARENA published, in whole seconds, or null.
 *
 * ## Why this is not the countdown the panel comment forbade
 *
 * `fighters-pane.tsx` says, and still says: *"There is no countdown: a countdown
 * is the window rule reimplemented in a browser."* That objection is about
 * *deciding* — a browser working out whether a window is open, from a duration
 * and a start, and then enabling a control on the strength of its own answer.
 * Nothing here does that. The arena publishes `closesAt`; this subtracts the
 * local clock from it and hands back a number to print.
 *
 * The difference is load-bearing and the UI must keep it visible:
 *
 *  - **This is the browser's clock, and is labelled as such.** Two machines
 *    disagree by seconds; the operator is told which one they are reading.
 *  - **Nothing is gated on it.** Submit lights on `selection` being present in
 *    the arena's last answer, exactly as before. Reaching zero here disables
 *    nothing, enables nothing, and sends nothing.
 *  - **Zero is not "closed".** It renders as zero and the panel goes on asking
 *    the arena, because the arena's answer is the only one that closes a window.
 */
export function secondsUntil(closesAt: string | null, nowMs: number): number | null {
  if (!closesAt) return null;
  const at = Date.parse(closesAt);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.round((at - nowMs) / 1000));
}

/** `m:ss`, for a number `secondsUntil` produced. Presentation only. */
export function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
