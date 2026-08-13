import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ARRANGEMENT,
  PANE_TITLES,
  ZONES,
  locate,
  move,
  normalise,
  nudge,
  type Arrangement,
  type PaneId,
} from "@/lib/layout";

/**
 * Where the cards are, and the rules for moving them.
 *
 * All of it is pure, which is the point of putting it in `lib/` rather than in
 * the component: a drag is the one interaction a unit test cannot honestly
 * reproduce, so the reordering has to be testable without one. The component
 * decides *when* to call these; these decide what the answer is, and the
 * keyboard path calls exactly the same functions as the pointer path.
 *
 * The cases that matter most are not the moves. They are `normalise`, which is
 * what a stored arrangement meets after the code that wrote it has changed —
 * and the invariant that no pane can be lost.
 */

/** Every pane, exactly once, wherever it is. */
function census(a: Arrangement): PaneId[] {
  return ZONES.flatMap((z) => a[z]).sort();
}

const ALL = (Object.keys(PANE_TITLES) as PaneId[]).sort();

describe("the shipped arrangement", () => {
  it("places every pane exactly once", () => {
    expect(census(DEFAULT_ARRANGEMENT)).toEqual(ALL);
  });

  it("does not contain the rail", () => {
    // The catalogue is sticky and viewport-sized; a card underneath it is
    // painted over the moment the page scrolls. It is not a movable pane and
    // there is no zone it can reach.
    expect(census(DEFAULT_ARRANGEMENT)).not.toContain("rail");
  });
});

describe("normalise — what a stored arrangement meets after a release", () => {
  it("appends a pane the stored value never heard of", () => {
    // The failure this function is really for: a card added in a later release
    // is missing from everybody's saved layout, and dropping it would make it
    // invisible to every operator who had ever rearranged their console.
    const stored = { wide: ["fighters"], left: ["chat"], right: ["response"] };
    const out = normalise(stored);
    expect(census(out)).toEqual(ALL);
  });

  it("puts a missing pane where it ships, not at the end of the first column", () => {
    const out = normalise({ wide: [], left: ["chat"], right: [] });
    // `standing` ships on the right, so it lands on the right.
    expect(out.right).toContain("standing");
    expect(out.left).not.toContain("standing");
  });

  it("discards a pane that no longer exists", () => {
    const out = normalise({ wide: ["fighters", "treasury"], left: [], right: [] });
    expect(census(out)).toEqual(ALL);
    expect(JSON.stringify(out)).not.toContain("treasury");
  });

  it("de-duplicates a pane stored in two zones", () => {
    const out = normalise({ wide: ["seat"], left: ["seat"], right: ["seat"] });
    expect(census(out)).toEqual(ALL);
    expect(out.wide.filter((p) => p === "seat")).toHaveLength(1);
  });

  it("survives junk without throwing", () => {
    for (const junk of [null, undefined, 0, "nope", [], { left: 5 }, { wide: [1, 2] }]) {
      expect(census(normalise(junk))).toEqual(ALL);
    }
  });
});

describe("move", () => {
  it("inserts before the named pane", () => {
    const out = move(DEFAULT_ARRANGEMENT, "standing", "left", "command");
    expect(out.left).toEqual(["chat", "standing", "command", "log"]);
    // The source zone, minus what moved out of it. Spelled from the default
    // rather than as a fixed pair, so adding a card to the shipped arrangement
    // is a one-line change here instead of a puzzle about which literal is
    // stale — the claim being pinned is that `move` removes from the source and
    // inserts before the named pane, not what ships in the right column.
    expect(out.right).toEqual(DEFAULT_ARRANGEMENT.right.filter((p) => p !== "standing"));
  });

  it("appends when there is nothing to go before", () => {
    const out = move(DEFAULT_ARRANGEMENT, "seat", "wide", null);
    // Spelled from the default for the same reason as the case above: the claim
    // is that a null anchor APPENDS, not what ships in the wide row.
    expect(out.wide).toEqual([...DEFAULT_ARRANGEMENT.wide, "seat"]);
  });

  it("never loses or duplicates a pane, wherever it lands", () => {
    for (const pane of ALL) {
      for (const zone of ZONES) {
        expect(census(move(DEFAULT_ARRANGEMENT, pane, zone, null))).toEqual(ALL);
      }
    }
  });

  it("dropping a pane onto itself is a no-op, not a disappearance", () => {
    // `before` is whatever the pointer was over, and it can be the card being
    // dragged. The filter removes it first, so the index lookup misses and it
    // falls through to the end of its own zone rather than vanishing.
    const out = move(DEFAULT_ARRANGEMENT, "chat", "left", "chat");
    expect(census(out)).toEqual(ALL);
    expect(out.left).toContain("chat");
  });
});

describe("nudge — the keyboard path", () => {
  it("moves a card up and down its own column", () => {
    const down = nudge(DEFAULT_ARRANGEMENT, "chat", "down");
    expect(down.left).toEqual(["command", "chat", "log"]);
    expect(nudge(down, "chat", "up").left).toEqual(DEFAULT_ARRANGEMENT.left);
  });

  it("walks sideways through wide → left → right", () => {
    const out = nudge(DEFAULT_ARRANGEMENT, "response", "left");
    expect(out.left).toContain("response");
    expect(out.right).not.toContain("response");
  });

  it("returns the SAME object at an edge, so a caller can tell nothing happened", () => {
    // Identity, not equality. The component announces "already at the edge"
    // off this, and a fresh-but-equal object would have it claim a move that
    // did not occur — to a screen reader, which cannot see that it did not.
    const a = DEFAULT_ARRANGEMENT;
    expect(nudge(a, "chat", "up")).toBe(a);
    expect(nudge(a, "log", "down")).toBe(a);
    expect(nudge(a, "fighters", "left")).toBe(a);
    expect(nudge(a, "standing", "right")).toBe(a);
  });

  it("never loses a pane in any direction from any position", () => {
    let a = DEFAULT_ARRANGEMENT;
    for (const dir of ["down", "right", "up", "left", "left", "down"] as const) {
      for (const pane of ALL) {
        a = nudge(a, pane, dir);
        expect(census(a)).toEqual(ALL);
      }
    }
  });
});

describe("locate", () => {
  it("finds every pane in the shipped arrangement", () => {
    for (const pane of ALL) {
      expect(locate(DEFAULT_ARRANGEMENT, pane)).not.toBeNull();
    }
  });
});

describe("the store never throws when storage is hostile", () => {
  beforeEach(() => {
    // A private window, or storage disabled. `combos.ts` makes the same
    // promise: a preference must not be able to take the console down.
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("denied");
      },
    });
  });

  it("falls back to the default arrangement", async () => {
    const { loadArrangement } = await import("@/lib/layout");
    expect(census(loadArrangement())).toEqual(ALL);
  });
});
