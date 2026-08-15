import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FIGHTERS_PANE, MATCH_PANE, resultPaneFor } from "@/lib/reveal";

/**
 * Where a settled command sends the page.
 *
 * Two things are worth a test and both are silent when wrong:
 *
 *  1. **The precedence.** Entering the throne answers with a match id AND a
 *     character id, so a check that tests the character first sends every paid
 *     entry to the Fighters pane. Nothing errors; the page simply goes to the
 *     wrong card, every time, on the paid entry.
 *  2. **The class strings.** A class named in two files is a scroll that stops
 *     working the day one is renamed — the element is not found and
 *     `scrollIntoView` is never reached, so there is no failure to notice.
 */

const root = join(__dirname, "..");
const src = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("which pane a settled answer belongs in", () => {
  it("sends an entry to the match pane even though it also names a character", () => {
    /*
      The arena's `enteredResponse`: `{ matchId, characterId }`. The match is
      the new thing; the character id says which fighter entered it.
    */
    expect(resultPaneFor({ matchId: "mat_01K1", characterId: 41 })).toBe("match");
  });

  it("sends a forge to the fighters pane", () => {
    expect(resultPaneFor({ characterId: 41 })).toBe("fighters");
  });

  it("sends a vacant-throne seating to the fighters pane", () => {
    /*
      `seatedResponse` is deliberately shaped unlike a challenge and carries no
      `matchId`, "because there is no match".
    */
    expect(resultPaneFor({ characterId: 41, seated: true })).toBe("fighters");
  });

  it("names no pane for an answer that names neither", () => {
    for (const body of [null, undefined, {}, { ok: true }, "not an object", 7]) {
      expect(resultPaneFor(body)).toBeNull();
    }
  });

  it("ignores the two fields at the wrong type", () => {
    expect(resultPaneFor({ matchId: 7 })).toBeNull();
    expect(resultPaneFor({ characterId: "41" })).toBeNull();
  });
});

describe("the panes carry the classes the reveal looks up", () => {
  it("is one shared constant per pane, never a literal", () => {
    expect(src("src/components/fighters-pane.tsx")).toMatch(/className=\{FIGHTERS_PANE\}/);
    expect(src("src/components/match-pane.tsx")).toMatch(/className=\{MATCH_PANE\}/);
    // The values themselves, so a rename has to happen in one place.
    expect(FIGHTERS_PANE).toBe("pane-fighters");
    expect(MATCH_PANE).toBe("pane-match");
  });

  it("only moves the page on a settled envelope with no error", () => {
    /*
      `settled` is the receipt the payment produced rather than anything this
      client inferred. A free read that answers with a match id is how an
      operator browses, and a refusal belongs on screen under the button that
      caused it — not scrolled away from.
    */
    expect(src("src/components/console.tsx")).toMatch(
      /if \(data\.settled && !data\.error\) revealResultPane\(data\.body\);/,
    );
  });
});
