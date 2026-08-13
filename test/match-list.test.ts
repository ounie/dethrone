import { describe, expect, it } from "vitest";
import { PAGE_SIZE, filterRows, page, readMatchRows, type MatchRow } from "@/lib/match-list";

/**
 * The history list: what it reads, what it filters, and what it does not
 * pretend to do.
 *
 * The last of those is the point of the paging cases. `GET /api/matches` takes
 * no limit, offset or cursor — measured against the live arena, not assumed —
 * so paging here is over rows already in hand, and a test that asserted a
 * "next page" fetch would be pinning an affordance the canon does not have.
 */

const THRONE = {
  matches: [
    {
      id: "mat_1",
      status: "completed",
      outcome: "DEFENDED",
      potAtStakeUsdc: "1.300000",
      champion: { displayName: "0xAAA…1", walletAddress: "0xAAA1" },
      challenger: { displayName: "0xBBB…2", walletAddress: "0xbbb2" },
      endedAt: "2026-08-13T17:42:38.633Z",
      createdAt: "2026-08-13T17:38:02.452Z",
    },
    { id: "mat_2", champion: {}, challenger: {} },
    // No id: cannot be opened, so it is not a row. Rendering it would put a
    // control on screen that can only fail.
    { status: "completed", champion: {}, challenger: {} },
  ],
};

describe("rows are read, never invented", () => {
  it("narrows a throne list", () => {
    const rows = readMatchRows(THRONE, "throne");
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe("mat_1");
    expect(rows[0].kind).toBe("throne");
    expect(rows[0].outcome).toBe("DEFENDED");
    expect(rows[0].championAddress).toBe("0xAAA1");
  });

  it("drops a row with no id", () => {
    expect(readMatchRows(THRONE, "throne").map((r) => r.id)).toEqual(["mat_1", "mat_2"]);
  });

  it("survives junk without throwing", () => {
    for (const junk of [null, undefined, 0, "no", [], {}, { matches: "nope" }]) {
      expect(readMatchRows(junk, "throne")).toEqual([]);
    }
  });

  it("marks duels as duels, so the filter is a fact and not a guess", () => {
    const rows = readMatchRows({ duels: [{ id: "duel_1" }] }, "duel");
    expect(rows[0].kind).toBe("duel");
  });
});

const rows: MatchRow[] = [
  { ...blank("a"), kind: "throne", championAddress: "0xME" },
  { ...blank("b"), kind: "throne", challengerAddress: "0xme" },
  { ...blank("c"), kind: "duel", championAddress: "0xOTHER" },
  { ...blank("d"), kind: "duel", challengerAddress: "0xME" },
];

function blank(id: string): MatchRow {
  return {
    id,
    kind: "throne",
    status: null,
    outcome: null,
    potUsdc: null,
    championName: null,
    championAddress: null,
    challengerName: null,
    challengerAddress: null,
    endedAt: null,
    createdAt: null,
  };
}

describe("filters", () => {
  it("selects by source for throne and duel", () => {
    expect(filterRows(rows, "throne", null).map((r) => r.id)).toEqual(["a", "b"]);
    expect(filterRows(rows, "duel", null).map((r) => r.id)).toEqual(["c", "d"]);
    expect(filterRows(rows, "all", null)).toHaveLength(4);
  });

  it("matches an address on either side, ignoring case", () => {
    // Hex case is display, never identity — an operator whose address is stored
    // checksummed would otherwise see none of their own matches.
    expect(filterRows(rows, "mine", "0xme").map((r) => r.id)).toEqual(["a", "b", "d"]);
  });

  /**
   * A console with no wallet has no matches of its own. Showing all of them
   * under a heading saying "Mine" would be a false claim about ownership, which
   * is worse than an empty list.
   */
  it("keeps nothing under `mine` with no operator", () => {
    expect(filterRows(rows, "mine", null)).toEqual([]);
  });
});

describe("paging", () => {
  const many: MatchRow[] = Array.from({ length: PAGE_SIZE * 2 + 3 }, (_, i) => blank(`m${i}`));

  it("cuts into pages of the stated size", () => {
    expect(page(many, 0).rows).toHaveLength(PAGE_SIZE);
    expect(page(many, 0).count).toBe(3);
    expect(page(many, 2).rows).toHaveLength(3);
  });

  /**
   * The common way to land out of range is not a bad argument — it is switching
   * from a filter with three pages to one with a single page while sitting on
   * page three, which would otherwise render an empty list that reads as "no
   * matches".
   */
  it("clamps an index that has fallen out of range", () => {
    expect(page(many, 99).index).toBe(2);
    expect(page(many, -4).index).toBe(0);
    expect(page([blank("only")], 5).rows).toHaveLength(1);
  });

  it("reports one page for an empty list rather than zero", () => {
    expect(page([], 0)).toEqual({ rows: [], index: 0, count: 1 });
  });
});
