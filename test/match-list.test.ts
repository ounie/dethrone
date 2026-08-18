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
      mode: "throne",
      status: "completed",
      outcome: "DEFENDED",
      winner: "THRONE",
      tally: { challenger: 2, throne: 3 },
      potAtStakeUsdc: "1.300000",
      arenaName: "The Drowned Coliseum",
      champion: { displayName: "0xAAA…1", walletAddress: "0xAAA1" },
      challenger: { displayName: "0xBBB…2", walletAddress: "0xbbb2" },
      throneFighterName: "Ishlial the Unquiet",
      challengerFighterName: "Mortheth the Undrowned",
      endedAt: "2026-08-13T17:42:38.633Z",
      createdAt: "2026-08-13T17:38:02.452Z",
    },
    { id: "mat_2", mode: "throne", champion: {}, challenger: {} },
    // No id: cannot be opened, so it is not a row. Rendering it would put a
    // control on screen that can only fail.
    { status: "completed", mode: "throne", champion: {}, challenger: {} },
  ],
};

describe("rows are read, never invented", () => {
  it("narrows a throne list", () => {
    const rows = readMatchRows(THRONE);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe("mat_1");
    expect(rows[0].kind).toBe("throne");
    expect(rows[0].outcome).toBe("DEFENDED");
    expect(rows[0].championAddress).toBe("0xAAA1");
    // The FIGHTER, not the owning agent — they are different facts and the row
    // renders the name beside a portrait.
    expect(rows[0].championFighterName).toBe("Ishlial the Unquiet");
    expect(rows[0].tally).toEqual({ challenger: 2, throne: 3 });
    expect(rows[0].arenaName).toBe("The Drowned Coliseum");
  });

  it("drops a row with no id", () => {
    expect(readMatchRows(THRONE).map((r) => r.id)).toEqual(["mat_1", "mat_2"]);
  });

  it("survives junk without throwing", () => {
    for (const junk of [null, undefined, 0, "no", [], {}, { matches: "nope" }]) {
      expect(readMatchRows(junk)).toEqual([]);
    }
  });

  it("reads the lane off the row rather than off the request", () => {
    /*
      The bug this replaces. `readMatchRows` used to take a `kind` argument and
      stamp it on everything it produced, so a row was a duel because of which
      endpoint answered — and the Duel tab was filled from `/api/duels/pool`,
      which lists OPEN listings and loses a duel the moment it is taken. The tab
      could only ever be empty of the thing it was named after.
    */
    const rows = readMatchRows({
      matches: [
        { id: "mat_d", mode: "duel" },
        { id: "mat_t", mode: "throne" },
        { id: "mat_x", mode: "exhibition" },
      ],
    });
    expect(rows.map((r) => r.kind)).toEqual(["duel", "throne", "undercard"]);
  });

  it("never folds an UNRECOGNISED lane into throne", () => {
    // A lane the arena named and this client has not been taught goes to the
    // conservative bucket, not the money-ordered one: a $0.15 exhibition in a
    // throne list is the misread §12.3 exists to prevent.
    const rows = readMatchRows({ matches: [{ id: "m", mode: "gauntlet" }] });
    expect(rows.map((r) => r.kind)).toEqual(["undercard"]);
  });

  it("reads an ABSENT lane as throne, because that route had no other", () => {
    /*
      The bug this pins, seen on screen: against an arena that predates the
      `mode` field, every row came back without one and this client rendered
      all eight throne matches as "UNDERCARD" — a label it invented, on the
      column whose only job is to say what a row is.

      Absent is not unrecognised. The older `/api/matches` selected
      `throne_matches`, so a response with no mode on it is structurally
      incapable of carrying anything but a throne match.
    */
    const rows = readMatchRows({ matches: [{ id: "n" }, { id: "o", mode: null }] });
    expect(rows.map((r) => r.kind)).toEqual(["throne", "throne"]);
  });

  it("refuses a half-read tally rather than rendering a blank in a score", () => {
    const rows = readMatchRows({
      matches: [
        { id: "a", tally: { challenger: 3 } },
        { id: "b", tally: null },
        { id: "c", tally: { challenger: 0, throne: 5 } },
      ],
    });
    expect(rows.map((r) => r.tally)).toEqual([null, null, { challenger: 0, throne: 5 }]);
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
    winner: null,
    tally: null,
    potUsdc: null,
    arenaName: null,
    championFighterName: null,
    challengerFighterName: null,
    championImageUrl: null,
    challengerImageUrl: null,
    demonstration: false,
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
