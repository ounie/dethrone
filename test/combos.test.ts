import { describe, expect, it } from "vitest";
import {
  applyCombo,
  comboFromPicks,
  combosFor,
  removeCombo,
  upsertCombo,
  type Combo,
} from "@/lib/combos";

/**
 * The saved-combo library, and the one bug it exists to prevent.
 *
 * A submitted sequence is five integers, but they are indices **into one
 * fighter's menu**, and a menu follows the genome. Saving the integers and
 * replaying them on a different fighter produces five legal integers naming
 * five different actions — accepted by the arena, wrong in the fight, and
 * silent until the verdict. So a combo stores action IDS and is resolved
 * against whichever menu it is applied to.
 *
 * A combo is also OWNED by the fighter it was built from and offered on no
 * other. That makes the cross-fighter cases below unreachable through the UI —
 * they are kept deliberately, because the id-not-index storage is what makes the
 * failure visible rather than silent if the filter is ever loosened, and a test
 * that only covers the path the UI takes cannot say that.
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

  it("removes by fighter and name together", () => {
    expect(removeCombo(upsertCombo([], a), 1, "opener")).toEqual([]);
  });
});

/**
 * The scoping, which is the reported bug rather than a hypothetical: "combo 1"
 * was saved from #293 and then offered on every other fighter, where three of
 * its five actions did not exist.
 */
describe("a combo belongs to the fighter it was saved from", () => {
  const onA = { ...combo(["heavy:0"]), name: "combo 1", fromCharacterId: 293 };
  const onB = { ...combo(["reach:0"]), name: "opener", fromCharacterId: 500 };
  const library = [onA, onB];

  it("offers a combo only on its own fighter", () => {
    expect(combosFor(library, 293)).toEqual([onA]);
    expect(combosFor(library, 500)).toEqual([onB]);
  });

  it("offers nothing on a fighter that has none", () => {
    expect(combosFor(library, 999)).toEqual([]);
  });

  it("offers nothing when no fighter is selected", () => {
    // Not "everything" and not the unowned ones. There is no screen that asks
    // for combos without a fighter, and a null resolving to some combos is how
    // an unfitting library gets back in front of the operator.
    expect(combosFor(library, null)).toEqual([]);
  });

  it("does not offer an unowned combo to anybody", () => {
    const orphan = { ...combo(["heavy:0"]), fromCharacterId: null };
    expect(combosFor([orphan], 293)).toEqual([]);
    expect(combosFor([orphan], null)).toEqual([]);
  });

  /**
   * The one that would bite silently. With the list filtered per fighter, a
   * name key that ignored the fighter would mean saving "combo 1" on #500
   * deleted the "combo 1" on #293 — an entry disappearing from a screen nobody
   * was looking at, caused by pressing Save.
   */
  it("lets two fighters hold a combo of the same name", () => {
    const sameName = { ...combo(["reach:0"]), name: "combo 1", fromCharacterId: 500 };
    const list = upsertCombo([onA], sameName);

    expect(list).toHaveLength(2);
    expect(combosFor(list, 293)).toEqual([onA]);
    expect(combosFor(list, 500)[0].actionIds).toEqual(["reach:0"]);
  });

  it("still replaces within one fighter", () => {
    const list = upsertCombo([onA], { ...onA, actionIds: ["heavy:2"] });
    expect(list).toHaveLength(1);
    expect(list[0].actionIds).toEqual(["heavy:2"]);
  });

  it("removes one fighter's combo without touching the other's namesake", () => {
    const sameName = { ...combo(["reach:0"]), name: "combo 1", fromCharacterId: 500 };
    const list = [onA, sameName];
    expect(removeCombo(list, 500, "combo 1")).toEqual([onA]);
    expect(removeCombo(list, 293, "combo 1")).toEqual([sameName]);
  });

  /**
   * The property the whole change buys: applied to its own fighter, a combo
   * always fits. `missing` becomes an invariant check rather than the ordinary
   * case it used to be.
   */
  it("resolves completely against the menu it was built from", () => {
    const saved = { ...combo(comboFromPicks([2, 0, 4], HEAVY)), fromCharacterId: 293 };
    const { picks, missing } = applyCombo(saved, HEAVY);
    expect(missing).toEqual([]);
    expect(picks).toEqual([2, 0, 4]);
  });
});
