import { describe, expect, it } from "vitest";
import { applyCombo, comboFromPicks, removeCombo, upsertCombo, type Combo } from "@/lib/combos";

/**
 * The saved-combo library, and the one bug it exists to prevent.
 *
 * A submitted sequence is five integers, but they are indices **into one
 * fighter's menu**, and a menu follows the genome. Saving the integers and
 * replaying them on a different fighter produces five legal integers naming
 * five different actions — accepted by the arena, wrong in the fight, and
 * silent until the verdict. So a combo stores action IDS and is resolved
 * against whichever menu it is applied to.
 */

/** Two fighters. They share `bearing:*` and differ in armament, as real menus do. */
const HEAVY = [
  { index: 0, id: "heavy:0" },
  { index: 1, id: "heavy:1" },
  { index: 2, id: "heavy:2" },
  { index: 3, id: "bearing:0" },
  { index: 4, id: "bearing:1" },
];

/** Same shared actions, DIFFERENT INDICES — which is the whole hazard. */
const REACH = [
  { index: 0, id: "reach:0" },
  { index: 1, id: "bearing:1" },
  { index: 2, id: "reach:1" },
  { index: 3, id: "bearing:0" },
];

const combo = (actionIds: string[]): Combo => ({
  name: "opener",
  actionIds,
  fromCharacterId: 1,
  savedAt: "2026-08-09T00:00:00.000Z",
});

describe("a combo names actions, never positions", () => {
  it("round-trips through the fighter it was saved from", () => {
    const picks = [3, 0, 4];
    const ids = comboFromPicks(picks, HEAVY);
    expect(ids).toEqual(["bearing:0", "heavy:0", "bearing:1"]);
    expect(applyCombo(combo(ids), HEAVY).picks).toEqual(picks);
  });

  it("re-resolves to DIFFERENT indices on a fighter with a different menu", () => {
    /*
      The assertion the whole module exists for. `bearing:0` is index 3 on one
      fighter and index 3 on the other by coincidence, so the test uses
      `bearing:1` — index 4 there, index 1 here. A library that stored integers
      would submit 4 to a fighter whose menu has no index 4, or worse, to one
      where 4 is something else entirely.
    */
    const ids = comboFromPicks([4, 3], HEAVY);
    expect(ids).toEqual(["bearing:1", "bearing:0"]);

    const applied = applyCombo(combo(ids), REACH);
    expect(applied.picks).toEqual([1, 3]);
    expect(applied.picks).not.toEqual([4, 3]);
    expect(applied.missing).toEqual([]);
  });

  it("drops what the fighter cannot do, and names it", () => {
    // Never substituted. A silent stand-in would be the panel writing a plan
    // the operator did not, and they could not tell the difference.
    const applied = applyCombo(combo(["heavy:1", "bearing:0", "heavy:2"]), REACH);
    expect(applied.picks).toEqual([3]);
    expect(applied.missing).toEqual(["heavy:1", "heavy:2"]);
  });

  it("preserves order for what did match", () => {
    const applied = applyCombo(combo(["bearing:1", "reach:1", "bearing:0"]), REACH);
    expect(applied.picks).toEqual([1, 2, 3]);
  });

  it("skips a pick the menu does not contain when saving", () => {
    expect(comboFromPicks([0, 99, 1], HEAVY)).toEqual(["heavy:0", "heavy:1"]);
  });
});

describe("the library", () => {
  const a = combo(["heavy:0"]);

  it("replaces by name rather than accumulating duplicates", () => {
    const once = upsertCombo([], a);
    const twice = upsertCombo(once, { ...a, actionIds: ["heavy:1"] });
    expect(twice).toHaveLength(1);
    expect(twice[0].actionIds).toEqual(["heavy:1"]);
  });

  it("trims the name, and refuses an empty one or an empty plan", () => {
    expect(upsertCombo([], { ...a, name: "  spaced  " })[0].name).toBe("spaced");
    expect(upsertCombo([], { ...a, name: "   " })).toEqual([]);
    expect(upsertCombo([], { ...a, actionIds: [] })).toEqual([]);
  });

  it("puts the newest first, so a just-saved combo is where you look", () => {
    const list = upsertCombo(upsertCombo([], a), { ...a, name: "second" });
    expect(list.map((c) => c.name)).toEqual(["second", "opener"]);
  });

  it("removes by name", () => {
    expect(removeCombo(upsertCombo([], a), "opener")).toEqual([]);
  });
});
