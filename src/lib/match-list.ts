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
 * ## Two sources, because throne matches and duels are two routes
 *
 * `/api/matches` is throne matches only; its own catalogue note says so. Duels
 * live behind `/api/duels/*`. The filter therefore selects a *source* as much as
 * it selects rows, and `Mine` is a predicate applied to whichever source is
 * loaded rather than a third endpoint — the operator's address is a fact this
 * console already holds, and comparing it locally avoids a signed read for a
 * question a filter can answer.
 */

export type MatchFilter = "all" | "throne" | "duel" | "mine";

export const MATCH_FILTERS: readonly { id: MatchFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "throne", label: "Throne" },
  { id: "duel", label: "Duel" },
  { id: "mine", label: "Mine" },
];

/** One row of history, from either source, narrowed to what the list renders. */
export interface MatchRow {
  id: string;
  /** `throne` or `duel` — which source it came from, not something inferred. */
  kind: "throne" | "duel";
  status: string | null;
  outcome: string | null;
  potUsdc: string | null;
  championName: string | null;
  championAddress: string | null;
  challengerName: string | null;
  challengerAddress: string | null;
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
 * Rows out of a list body, from either route.
 *
 * The two shapes differ and are read separately rather than through one
 * normaliser with optional fields everywhere — the tell that a reader has
 * started guessing is a chain of `??` across field names from different APIs.
 */
export function readMatchRows(body: unknown, kind: "throne" | "duel"): MatchRow[] {
  const o = (body ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(o.matches) ? o.matches : Array.isArray(o.duels) ? o.duels : [];
  const out: MatchRow[] = [];

  for (const entry of raw) {
    const m = (entry ?? {}) as Record<string, unknown>;
    // A row with no id cannot be opened, so it is not a row. Rendering one would
    // put a control on screen that can only fail.
    const id = str(m.id) ?? str(m.matchId) ?? str(m.duelId);
    if (!id) continue;

    const champion = party(m.champion ?? m.throne ?? m.poster);
    const challenger = party(m.challenger ?? m.taker ?? m.opponent);

    out.push({
      id,
      kind,
      status: str(m.status) ?? str(m.state),
      outcome: str(m.outcome),
      potUsdc: str(m.potAtStakeUsdc) ?? str(m.stakeUsdc),
      championName: champion.name,
      championAddress: champion.address,
      challengerName: challenger.name,
      challengerAddress: challenger.address,
      endedAt: str(m.endedAt),
      createdAt: str(m.createdAt),
    });
  }
  return out;
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
