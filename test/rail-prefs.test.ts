import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFS,
  DEFAULT_SECTION_ORDER,
  MAX_PINNED,
  SECTIONS,
  moveSection,
  normalisePrefs,
  nudgeSection,
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
  it("name every section exactly once", () => {
    expect([...DEFAULT_SECTION_ORDER].sort()).toEqual([...SECTIONS].sort());
    expect(DEFAULT_PREFS.pinned).toEqual([]);
  });

  it("cover every tier the catalogue actually uses", () => {
    // A tier present in COMMANDS but missing here would render as a group that
    // never appears — a whole class of commands invisible.
    const used = new Set(COMMANDS.map((c) => c.tier));
    for (const tier of used) expect(DEFAULT_SECTION_ORDER).toContain(tier);
  });

  it("puts the shelf on top", () => {
    expect(DEFAULT_SECTION_ORDER[0]).toBe("pinned");
  });
});

describe("normalisePrefs — a stored preference after a release", () => {
  it("restores a section the stored value never heard of", () => {
    const out = normalisePrefs({ sectionOrder: ["paid"], pinned: [] });
    expect([...out.sectionOrder].sort()).toEqual([...SECTIONS].sort());
  });

  it("reads the old `tierOrder` key, so a saved arrangement is not lost", () => {
    // `pinned` was added after that key shipped. An operator who put paid
    // writes first keeps them first.
    const out = normalisePrefs({ tierOrder: ["paid", "free", "signed"], pinned: [] });
    expect(out.sectionOrder.filter((x) => x !== "pinned")).toEqual(["paid", "free", "signed"]);
  });

  it("restores the shelf at its DEFAULT index, not at the end", () => {
    /*
      The case this function exists for. Appending would have moved every
      existing operator's shelf to the bottom of the column on upgrade — a
      preference nobody expressed, applied silently.
    */
    const out = normalisePrefs({ tierOrder: ["paid", "free", "signed"] });
    expect(out.sectionOrder[0]).toBe("pinned");
  });

  it("keeps the shelf where the operator put it", () => {
    const out = normalisePrefs({ sectionOrder: ["paid", "pinned", "free", "signed"] });
    expect(out.sectionOrder).toEqual(["paid", "pinned", "free", "signed"]);
  });

  it("discards a section that no longer exists, and de-duplicates", () => {
    const out = normalisePrefs({ sectionOrder: ["paid", "paid", "admin", "free"], pinned: [] });
    expect(out.sectionOrder.filter((t) => t === "paid")).toHaveLength(1);
    expect(JSON.stringify(out.sectionOrder)).not.toContain("admin");
    expect([...out.sectionOrder].sort()).toEqual([...SECTIONS].sort());
  });

  it("de-duplicates pins and caps them", () => {
    const many = Array.from({ length: MAX_PINNED + 8 }, (_, i) => `cmd-${i}`);
    const out = normalisePrefs({ sectionOrder: [], pinned: [...many, ...many] });
    expect(out.pinned.length).toBeLessThanOrEqual(MAX_PINNED);
    expect(new Set(out.pinned).size).toBe(out.pinned.length);
  });

  it("survives junk without throwing", () => {
    for (const junk of [null, undefined, 0, "nope", [], { sectionOrder: 5 }, { pinned: [1, 2] }]) {
      const out = normalisePrefs(junk);
      expect([...out.sectionOrder].sort()).toEqual([...SECTIONS].sort());
      expect(Array.isArray(out.pinned)).toBe(true);
    }
  });
});

describe("moving a section", () => {
  const base: RailPrefs = { sectionOrder: ["pinned", "free", "paid", "signed"], pinned: [] };

  it("puts paid on top, which is the thing that was asked for", () => {
    let p = nudgeSection(base, "paid", "up");
    p = nudgeSection(p, "paid", "up");
    expect(p.sectionOrder).toEqual(["paid", "pinned", "free", "signed"]);
    expect(moveSection(base, "paid", "pinned").sectionOrder).toEqual([
      "paid",
      "pinned",
      "free",
      "signed",
    ]);
  });

  it("moves the shelf like anything else", () => {
    // The whole point of putting `pinned` in the order rather than above it.
    expect(nudgeSection(base, "pinned", "down").sectionOrder).toEqual([
      "free",
      "pinned",
      "paid",
      "signed",
    ]);
    expect(moveSection(base, "pinned", null).sectionOrder.at(-1)).toBe("pinned");
  });

  it("returns the SAME object at an edge, so a caller can tell nothing happened", () => {
    expect(nudgeSection(base, "pinned", "up")).toBe(base);
    expect(nudgeSection(base, "signed", "down")).toBe(base);
  });

  it("never loses or duplicates a section, from any position", () => {
    let p = base;
    for (const dir of ["down", "up", "down", "down"] as const) {
      for (const section of SECTIONS) {
        p = nudgeSection(p, section, dir);
        expect([...p.sectionOrder].sort()).toEqual([...SECTIONS].sort());
      }
    }
    for (const section of SECTIONS) {
      for (const before of [...SECTIONS, null]) {
        const out = moveSection(base, section, before);
        expect([...out.sectionOrder].sort()).toEqual([...SECTIONS].sort());
      }
    }
  });

  it("dropping a section on itself changes nothing about the set", () => {
    const out = moveSection(base, "paid", "paid");
    expect([...out.sectionOrder].sort()).toEqual([...SECTIONS].sort());
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

  it("leaves the section order alone", () => {
    const moved = nudgeSection(DEFAULT_PREFS, "paid", "up");
    expect(togglePin(moved, "forge").sectionOrder).toEqual(moved.sectionOrder);
  });
});
