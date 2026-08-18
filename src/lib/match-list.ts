/**
 * The match history: rows, filters, and pages.
 *
 * ## The arena paginates nothing, and this does not pretend otherwise
 *
 * `GET /api/matches` takes a `status` and returns what it returns — there is no
 * `limit`, no `offset`, no cursor, and passing one changes nothing (measured,
 * not assumed). So the paging here is over **the rows the arena actually sent**,
 * and the card says so rather than implying there is a page two waiting on the
 * server. A "next" button that silently did nothing would be the console
 * inventing an affordance the canon does not have — the same fault as a UI that
 * branches on game state, wearing a different hat.
 *
 * ## One source now, and the lane is READ rather than inferred
 *
 * This used to load two routes: `/api/matches` for throne rows and
 * `/api/duels/pool` for the Duel tab. The second was never history — the pool
 * lists OPEN listings, so a settled duel leaves it the moment it settles, and
 * the Duel tab could only ever say "Nothing to show for this filter". It did,
 * for the whole life of the mode.
 *
 * `/api/matches` now takes a `mode` and serves the same `duelHistory()` reader
 * the arena's own `/matches` page renders, so every lane arrives from one route
 * with one shape. `kind` is therefore the row's OWN `mode` field rather than a
 * label this file attaches from which endpoint answered — the tell that a
 * client has started guessing is exactly that kind of inference, and it is what
 * made the old Duel tab a filter over rows that were never duels.
 *
 * `Mine` stays a predicate rather than a source: the operator's address is a
 * fact this console already holds, and comparing it locally avoids a signed
 * read for a question a filter can answer.
 */

export type MatchFilter = "all" | "throne" | "duel" | "summon" | "mine";

export const MATCH_FILTERS: readonly { id: MatchFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "throne", label: "Throne" },
  { id: "duel", label: "Duel" },
  /*
    House Cards, which the arena calls `summons` on the row and `Summon` on
    every surface a reader sees. The pill is here because `mode=all` has carried
    these rows since the arena added the lane — they were arriving already, and
    landing in the `undercard` bucket, which is the one label they are not: an
    undercard match took a fee, and a House Card cannot.
  */
  { id: "summon", label: "Summon" },
  { id: "mine", label: "Mine" },
];

/** One row of history, narrowed to what the list renders. */
export interface MatchRow {
  id: string;
  /**
   * The lane, as the ARENA stated it on the row.
   *
   * Never inferred from which request produced it. `undercard` covers spars and
   * exhibitions, which this console does not filter for but must not silently
   * relabel as something it does.
   */
  kind: "throne" | "duel" | "summons" | "undercard";
  status: string | null;
  /**
   * `DEFENDED` / `SEAT_TAKEN` / `VOIDED`, or null on a lane that writes none.
   *
   * A duel writes none — those are the throne's words, and a duel has no seat —
   * so `winner` below is what settles one. A renderer that treats null as
   * "defended" is repeating the arena's own bug: `/matches` had `Defended` as
   * the final else and printed it on the first duel ever fought.
   */
  outcome: string | null;
  /** `CHALLENGER` / `THRONE` — the arena's stored roles, never relabelled here.
   *  What to CALL them is per lane and belongs to the renderer. */
  winner: string | null;
  /** Coins to each side, or null where no verdict is published. */
  tally: { challenger: number; throne: number } | null;
  potUsdc: string | null;
  arenaName: string | null;
  championName: string | null;
  championAddress: string | null;
  challengerName: string | null;
  challengerAddress: string | null;
  /** The FIGHTERS, which are not their owners — a name sits beside a portrait,
   *  and reading the owner's name there is only correct while an agent owns
   *  exactly one. The arena's `history.ts` makes the same point at length. */
  championFighterName: string | null;
  challengerFighterName: string | null;
  /** Resolved by the arena. Never a path composed here: a client that builds an
   *  S3 URL holds a second copy of where those objects live. */
  championImageUrl: string | null;
  challengerImageUrl: string | null;
  /** True when no money moved. */
  demonstration: boolean;
  endedAt: string | null;
  createdAt: string | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function party(raw: unknown): { name: string | null; address: string | null } {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    name: str(o.displayName) ?? str(o.name),
    address: str(o.walletAddress) ?? str(o.address),
  };
}

/**
 * Rows out of a list body.
 *
 * One shape now, because one route serves every lane. The old version took a
 * `kind` argument and stamped it on every row it produced — which is how the
 * Duel tab came to be full of things that were not duels, and then empty of the
 * ones that were. The lane is a field on the row and is read like any other.
 */
export function readMatchRows(body: unknown): MatchRow[] {
  const o = (body ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(o.matches) ? o.matches : [];
  const out: MatchRow[] = [];

  for (const entry of raw) {
    const m = (entry ?? {}) as Record<string, unknown>;
    // A row with no id cannot be opened, so it is not a row. Rendering one would
    // put a control on screen that can only fail.
    const id = str(m.id) ?? str(m.matchId);
    if (!id) continue;

    const champion = party(m.champion);
    const challenger = party(m.challenger);

    out.push({
      id,
      kind: laneOf(str(m.mode)),
      status: str(m.status),
      outcome: str(m.outcome),
      winner: str(m.winner),
      tally: tallyOf(m.tally),
      potUsdc: str(m.potAtStakeUsdc),
      arenaName: str(m.arenaName) ?? str(m.arenaSlug),
      championName: champion.name,
      championAddress: champion.address,
      challengerName: challenger.name,
      challengerAddress: challenger.address,
      championFighterName: str(m.throneFighterName),
      challengerFighterName: str(m.challengerFighterName),
      championImageUrl: str(m.throneImageUrl),
      challengerImageUrl: str(m.challengerImageUrl),
      demonstration: m.demonstration === true,
      endedAt: str(m.endedAt),
      createdAt: str(m.createdAt),
    });
  }
  return out;
}

/**
 * The arena's mode, narrowed to the three lanes this list distinguishes.
 *
 * **Absent and unrecognised are different answers**, and conflating them was a
 * live bug: this returned `undercard` for both, so against an arena that
 * predates the `mode` field EVERY row — all of them throne matches — rendered
 * as "undercard". A label invented by this client, on the one surface whose job
 * is to state what a row actually is.
 *
 * - **Absent** means the arena did not say, which only happens on the older
 *   `/api/matches`. That route selected `throne_matches` and could return
 *   nothing else, so `throne` is not a guess there — it is the only lane the
 *   response is capable of carrying.
 * - **Unrecognised** means the arena named a lane this client has not been
 *   taught. That falls to `undercard`, the conservative bucket, because a
 *   $0.15 exhibition sitting in a money-ordered list is the misread §12.3
 *   exists to prevent.
 */
function laneOf(mode: string | null): MatchRow["kind"] {
  if (mode === null) return "throne";
  if (mode === "throne") return "throne";
  if (mode === "duel") return "duel";
  // A House Card is not undercard. Both settle no seat and no record, but an
  // undercard match TOOK A FEE and a summons cannot — the arena refuses one at
  // the database — so filing it under the conservative bucket states the one
  // thing about it that is false.
  if (mode === "summons") return "summons";
  return "undercard";
}

/** The two coin counts, or null. Both must be numbers — a half-read tally
 *  would render as a score with a blank in it. */
function tallyOf(raw: unknown): MatchRow["tally"] {
  const t = (raw ?? {}) as Record<string, unknown>;
  const challenger = t.challenger;
  const throne = t.throne;
  if (typeof challenger !== "number" || typeof throne !== "number") return null;
  return { challenger, throne };
}

/** Case-insensitive address comparison. Addresses are hex and case is display. */
function sameAddress(a: string | null, b: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/**
 * Apply a filter to rows already loaded.
 *
 * `mine` is the only one that is a predicate rather than a source: it keeps rows
 * where the operator is on either side. With no operator — a read-only deploy —
 * it keeps nothing, which is correct and is not the same as keeping everything:
 * a console with no wallet has no matches of its own, and showing all of them
 * under a heading saying "Mine" would be a false claim about ownership.
 */
export function filterRows(
  rows: readonly MatchRow[],
  filter: MatchFilter,
  operator: string | null,
): MatchRow[] {
  if (filter === "throne") return rows.filter((r) => r.kind === "throne");
  if (filter === "duel") return rows.filter((r) => r.kind === "duel");
  if (filter === "summon") return rows.filter((r) => r.kind === "summons");
  if (filter === "mine") {
    return rows.filter(
      (r) => sameAddress(r.championAddress, operator) || sameAddress(r.challengerAddress, operator),
    );
  }
  return [...rows];
}

export const PAGE_SIZE = 8;

export interface Page {
  rows: MatchRow[];
  /** 0-based, clamped into range so a filter change cannot strand the view. */
  index: number;
  count: number;
}

/**
 * One page of rows.
 *
 * The index is clamped rather than trusted, because the common way to land out
 * of range is not a bad argument — it is switching from a filter with four pages
 * to one with a single page while sitting on page three, which would otherwise
 * render an empty list that looks like "no matches".
 */
export function page(rows: readonly MatchRow[], index: number): Page {
  const count = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const clamped = Math.min(Math.max(0, index), count - 1);
  const start = clamped * PAGE_SIZE;
  return { rows: rows.slice(start, start + PAGE_SIZE), index: clamped, count };
}
