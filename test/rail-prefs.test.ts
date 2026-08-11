import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFS,
  DEFAULT_TIER_ORDER,
  MAX_PINNED,
  TIERS,
  moveTier,
  normalisePrefs,
  nudgeTier,
  togglePin,
  type RailPrefs,
} from "@/lib/rail-prefs";
import { COMMANDS } from "@/lib/commands";

/**
 * How the operator arranged the catalogue.
 *
 * Pure, for the reason `layout.ts`'s rules are: a drag cannot be reproduced in
 * a unit test, so the reordering has to be answerable without one — and the
 * keyboard path calls exactly these functions too.
 *
 * The case that matters is `normalisePrefs`, which is what a stored preference
 * meets after the code that wrote it has moved on. Everything else is a move.
 */

describe("the shipped defaults", () => {
  it("name every tier exactly once", () => {
    expect([...DEFAULT_TIER_ORDER].sort()).toEqual([...TIERS].sort());
    expect(DEFAULT_PREFS.pinned).toEqual([]);
  });

  it("cover every tier the catalogue actually uses", () => {
    // A tier present in COMMANDS but missing here would render as a group that
    // never appears — a whole class of commands invisible.
    const used = new Set(COMMANDS.map((c) => c.tier));
    for (const tier of used) expect(DEFAULT_TIER_ORDER).toContain(tier);
  });
});

describe("normalisePrefs — a stored preference after a release", () => {
  it("appends a tier the stored value never heard of", () => {
    const out = normalisePrefs({ tierOrder: ["paid"], pinned: [] });
    expect([...out.tierOrder].sort()).toEqual([...TIERS].sort());
    // The operator's own choice still leads.
    expect(out.tierOrder[0]).toBe("paid");
  });

  it("discards a tier that no longer exists, and de-duplicates", () => {
    const out = normalisePrefs({ tierOrder: ["paid", "paid", "admin", "free"], pinned: [] });
    expect(out.tierOrder.filter((t) => t === "paid")).toHaveLength(1);
    expect(JSON.stringify(out.tierOrder)).not.toContain("admin");
    expect([...out.tierOrder].sort()).toEqual([...TIERS].sort());
  });

  it("de-duplicates pins and caps them", () => {
    const many = Array.from({ length: MAX_PINNED + 8 }, (_, i) => `cmd-${i}`);
    const out = normalisePrefs({ tierOrder: [], pinned: [...many, ...many] });
    expect(out.pinned.length).toBeLessThanOrEqual(MAX_PINNED);
    expect(new Set(out.pinned).size).toBe(out.pinned.length);
  });

  it("survives junk without throwing", () => {
    for (const junk of [null, undefined, 0, "nope", [], { tierOrder: 5 }, { pinned: [1, 2] }]) {
      const out = normalisePrefs(junk);
      expect([...out.tierOrder].sort()).toEqual([...TIERS].sort());
      expect(Array.isArray(out.pinned)).toBe(true);
    }
  });
});

describe("moving a tier", () => {
  const base: RailPrefs = { tierOrder: ["free", "paid", "signed"], pinned: [] };

  it("puts paid on top, which is the thing that was asked for", () => {
    expect(nudgeTier(base, "paid", "up").tierOrder).toEqual(["paid", "free", "signed"]);
    expect(moveTier(base, "paid", "free").tierOrder).toEqual(["paid", "free", "signed"]);
  });

  it("returns the SAME object at an edge, so a caller can tell nothing happened", () => {
    expect(nudgeTier(base, "free", "up")).toBe(base);
    expect(nudgeTier(base, "signed", "down")).toBe(base);
  });

  it("never loses or duplicates a tier, from any position", () => {
    let p = base;
    for (const dir of ["down", "up", "down", "down"] as const) {
      for (const tier of TIERS) {
        p = nudgeTier(p, tier, dir);
        expect([...p.tierOrder].sort()).toEqual([...TIERS].sort());
      }
    }
    for (const tier of TIERS) {
      for (const before of [...TIERS, null]) {
        const out = moveTier(base, tier, before);
        expect([...out.tierOrder].sort()).toEqual([...TIERS].sort());
      }
    }
  });

  it("dropping a tier on itself changes nothing about the set", () => {
    const out = moveTier(base, "paid", "paid");
    expect([...out.tierOrder].sort()).toEqual([...TIERS].sort());
  });
});

describe("pinning", () => {
  it("adds, then removes", () => {
    const once = togglePin(DEFAULT_PREFS, "seat");
    expect(once.pinned).toEqual(["seat"]);
    expect(togglePin(once, "seat").pinned).toEqual([]);
  });

  it("rolls at the cap rather than refusing", () => {
    /*
      A shortcut list that silently stops accepting shortcuts reads as broken.
      The OLDEST goes, so the pin just made is always the one that stuck.
    */
    let p = DEFAULT_PREFS;
    for (let i = 0; i < MAX_PINNED + 3; i++) p = togglePin(p, `cmd-${i}`);
    expect(p.pinned).toHaveLength(MAX_PINNED);
    expect(p.pinned.at(-1)).toBe(`cmd-${MAX_PINNED + 2}`);
    expect(p.pinned).not.toContain("cmd-0");
  });

  it("leaves the tier order alone", () => {
    const moved = nudgeTier(DEFAULT_PREFS, "paid", "up");
    expect(togglePin(moved, "forge").tierOrder).toEqual(moved.tierOrder);
  });
});
