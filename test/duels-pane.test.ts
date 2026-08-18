import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DuelsPane from "@/components/duels-pane";
import { COMMANDS } from "@/lib/commands";
import { SRC, read, ts, visitFile } from "./graph";

/**
 * The Duel pool card is a keyboard for the command pane, exactly like the
 * Fighters panel — and it is the more dangerous of the two, because every row
 * on it is a stake somebody posted and the button beside it says "Take this".
 *
 * That is one careless edit away from being a second place money leaves the
 * console. These are the assertions that make "it arms, it does not spend" a
 * property rather than an intention, and they are deliberately the same shape
 * as `fighters-pane.test.ts`: the two panes make the same promise, so a reader
 * comparing them should not have to work out whether they mean the same thing.
 *
 * `createElement` rather than JSX and `renderToStaticMarkup` rather than a DOM,
 * for the reasons `catalogue-render.test.ts` gives: this is a static question
 * about output, JSX would make it depend on a transform config, and a DOM would
 * add a lifecycle to a question that has none.
 */

const PANE = join(SRC, "components/duels-pane.tsx");

function render(pool: { enabled: boolean; reason?: string }): string {
  return renderToStaticMarkup(
    createElement(DuelsPane, {
      capabilities: { pool },
      // Read only to notice that the wallet changed, which is a client-side
      // question a static render cannot ask.
      operator: null,
      disabled: false,
      selectedFighter: null,
      onArm: () => {},
    }),
  );
}

/**
 * Every command id this component hands to the named function.
 *
 * Read off the AST rather than the text, so a rename or a reformat cannot
 * quietly drop one from the set. Only string literals are collected; an
 * `act(someVariable, …)` would be invisible here, which is why the assertions
 * below also refuse a non-literal argument.
 */
function callsNaming(fn: string): { literals: string[]; dynamic: number } {
  const literals: string[] = [];
  let dynamic = 0;
  visitFile(PANE, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (!ts.isIdentifier(node.expression) || node.expression.text !== fn) return;
    const first = node.arguments[0];
    if (first && ts.isStringLiteral(first)) literals.push(first.text);
    else dynamic++;
  });
  return { literals, dynamic };
}

describe("the Duel pool card spends nothing", () => {
  const { literals, dynamic } = callsNaming("act");
  const armed = callsNaming("onArm");
  const paid = new Set(COMMANDS.filter((c) => c.tier === "paid").map((c) => c.id));

  it("issues at least one command, so the assertions below are not vacuous", () => {
    expect(literals.length).toBeGreaterThan(0);
  });

  it("names every command it issues as a literal", () => {
    expect(dynamic, "a command id is computed rather than named").toBe(0);
  });

  it("issues no paid command, ever", () => {
    /*
      The card's whole claim, and the reason this file exists.

      `take_duel` is paid and caller-priced. The shortest possible "improvement"
      to this card is wiring "Take this" straight through to
      `act("take_duel", …)` — one line, looks like a convenience, and turns a
      list of other people's stakes into a row of one-click settlements with no
      confirmation dialog between them. This fails on that line.
    */
    const offenders = literals.filter((id) => paid.has(id));
    expect(offenders, `these are paid: ${offenders.join(", ")}`).toEqual([]);
  });

  it("reads the pool and nothing else", () => {
    // Not a general "only free commands" assertion — this one pins the card to
    // the single read it is named after. A second read creeping in here (the
    // duel detail, the arena list) is how a market card starts assembling a
    // richer listing than the pool publishes, which the pool is anonymous on
    // purpose to prevent.
    expect(literals).toEqual(["pool"]);
  });

  it("arms take_duel, and only commands that exist in the catalogue", () => {
    /*
      The other half, and the half with no symptom. An `act()` with a bad id
      gets an error envelope the operator can see; an `onArm()` with a bad id
      reaches `loadCommand`, whose `byId` returns undefined and which then
      returns silently — a button that looks live, does nothing, reports
      nothing.
    */
    const known = new Set(COMMANDS.map((c) => c.id));
    const unknown = armed.literals.filter((id) => !known.has(id));
    expect(unknown, `armed but not in the catalogue: ${unknown.join(", ")}`).toEqual([]);
    expect(armed.dynamic, "a command id is computed rather than named").toBe(0);
    expect(armed.literals).toContain("take_duel");
  });

  it("arms a ceiling, so the command it fills can actually run", () => {
    /*
      `take_duel` is caller-priced, and `/api/act` refuses a caller-priced
      command with no `maxCents` before it signs anything. A "Take this" that
      filled only the id and the fighter therefore armed a command whose Run
      button could not run — reported as "nothing happens", because the refusal
      landed in the Response pane in the other column.

      This asserts the key is present rather than checking a value: the value
      comes from `stakeToCents`, which `test/stake.test.ts` pins on its own, and
      a fixed number here would be a price typed into a test.
    */
    const keys: string[] = [];
    visitFile(PANE, (node) => {
      if (!ts.isCallExpression(node)) return;
      if (!ts.isIdentifier(node.expression) || node.expression.text !== "onArm") return;
      const second = node.arguments[1];
      if (!second || !ts.isObjectLiteralExpression(second)) return;
      for (const prop of second.properties) {
        if (prop.name && ts.isIdentifier(prop.name)) keys.push(prop.name.text);
      }
    });
    expect(keys).toContain("maxCents");
    expect(keys).toContain("id");
    expect(keys).toContain("characterId");
  });

  it("converts the stake through lib rather than inline", () => {
    /*
      The conversion must stay in `lib/stake.ts`, which is where it can be
      pinned by tests and where the currency-literals scan does not reach —
      NOT because the scan is the point, but because an inline `* 100` in a
      component is the exact shape of "a UI that computes money", and the next
      one would not come with an explanation.
    */
    const source = read(PANE)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\/.*$/gm, "");
    expect(source, "money arithmetic in a component").not.toMatch(
      /parseFloat|Number\([^)]*stake|\*\s*100\b/,
    );
    expect(source).toContain("stakeToCents");
  });

  it("runs no clock, and no poll", () => {
    /*
      Two rules at once, and the same regex serves both.

      No countdown, for `seat-state.tsx`'s reason: a clock this console ran
      would be a second implementation of a rule it does not hold.

      And no timer-driven re-read. The pool is never cached and listings do get
      taken by other agents, which is an argument for the Re-read button and NOT
      for a poll — a list that refreshes itself holds a rate limit open against
      a market nobody is looking at, and it makes the header's "as of the last
      read" a sentence about a moment the operator never chose.
    */
    const source = read(PANE)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\/.*$/gm, "");
    expect(source, "a countdown or a poll").not.toMatch(/setTimeout|setInterval|getTime\(\)/);
  });

  it("never sorts or filters the listings it was handed", () => {
    /*
      A UI that branches on game state is a second implementation of the game,
      and a market list is where that starts: cheapest-first, an "affordable"
      badge, a row hidden because the ceiling could not cover it. The pool read
      carries `sort`, `dir`, `minStake` and `maxStake` — those belong to the
      arena, which is why this card sends none of them and reorders nothing.

      Scoped to the render path rather than the whole file: `listingsOf` is
      allowed to DROP a malformed row, and does, which is a shape check and not
      an opinion about the market.
    */
    const source = read(PANE)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\/.*$/gm, "");
    expect(source, "the browser reordering a market").not.toMatch(
      /\.sort\(|\.reverse\(|localeCompare/,
    );
  });
});

describe("a deploy with duels switched off is told why, in the server's own words", () => {
  const reason = "The arena reports that duels are closed.";
  const html = render({ enabled: false, reason });

  it("renders the capability's reason verbatim", () => {
    // Never a sentence invented here. Whether this deploy can read the pool is
    // a fact the server established; a browser that worked it out for itself
    // would be a second implementation of the rules.
    expect(html).toContain(reason);
  });

  it("offers no Take button when the pool cannot be read", () => {
    /*
      The BUTTON, not the phrase. This assertion first read
      `not.toContain("Take this")` and failed on the card's own caveat
      paragraph, which quotes the control by name — a false positive that was
      pointing at something real: the caveat was rendering on a card whose body
      says duels are closed, explaining a button that was not on the screen.
      The paragraph is now gated on the pool being readable, and this checks the
      class the button actually carries so prose about a control can never again
      be mistaken for the control.
    */
    expect(html).not.toContain("duel-take");
  });
});

describe("an enabled pool renders its own caveats", () => {
  const html = render({ enabled: true });

  it("says the arming settles nothing, on the card itself", () => {
    // The Fighters panel prints the same sentence under its arm row. It has to
    // be on both: they are in different columns, and an operator arriving at a
    // Take button from the market has not read the other one.
    // The three claims, not one sentence. This first read
    // `toContain("fills the command pane and stops")` and broke the moment the
    // caveat grew a clause about the prefilled ceiling — an assertion pinned to
    // prose punishes the edit that makes the prose more accurate.
    expect(html).toContain("fills the command pane");
    expect(html).toContain("and stops");
    expect(html).toContain("Nothing here settles an amount");
  });

  it("says the pool is anonymous rather than quietly showing less", () => {
    // The absence of a host column is a property of the arena's read, not an
    // omission by this card, and a market list with no counterparty is strange
    // enough to be worth naming.
    expect(html).toContain("anonymous by design");
  });
});
