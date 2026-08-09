import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FightersPane from "@/components/fighters-pane";
import { COMMANDS } from "@/lib/commands";
import { SRC, read, ts, visitFile } from "./graph";

/**
 * The Fighters panel is a keyboard for other panes, and these are the two
 * properties that make that true rather than intended.
 *
 * `createElement` rather than JSX and `renderToStaticMarkup` rather than a DOM,
 * for `catalogue-render.test.ts`'s reasons: this is a static question about
 * output, JSX would make it depend on a transform config, and a DOM would add a
 * lifecycle to a question that has none.
 */

const PANE = join(SRC, "components/fighters-pane.tsx");

/**
 * A stand-in for what `GET /api/rules` publishes. Named rather than inlined so
 * the tests below read as "the canon said five", never as "five".
 */
const SEQ = 5;

function render(stable: { enabled: boolean; reason?: string }): string {
  return renderToStaticMarkup(
    createElement(FightersPane, {
      capabilities: { stable },
      disabled: false,
      sequenceLength: SEQ,
      onArm: () => {},
    }),
  );
}

/**
 * Every command id this component hands to `act()`.
 *
 * Read off the AST rather than the text, so a rename or a reformat cannot
 * quietly drop one from the set. Only string literals are collected; a
 * `act(someVariable, …)` would be invisible here, which is why the second test
 * below also refuses a non-literal argument.
 */
function commandIdsIssued(): { literals: string[]; dynamic: number } {
  const literals: string[] = [];
  let dynamic = 0;
  visitFile(PANE, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (!ts.isIdentifier(node.expression) || node.expression.text !== "act") return;
    const first = node.arguments[0];
    if (first && ts.isStringLiteral(first)) literals.push(first.text);
    else dynamic++;
  });
  return { literals, dynamic };
}

describe("the Fighters panel spends nothing", () => {
  const { literals, dynamic } = commandIdsIssued();
  const paid = new Set(COMMANDS.filter((c) => c.tier === "paid").map((c) => c.id));

  it("issues at least one command, so the assertions below are not vacuous", () => {
    expect(literals.length).toBeGreaterThan(0);
  });

  it("names every command it issues as a literal", () => {
    // A computed id would put this component's command surface beyond the reach
    // of the next assertion, which is the only thing standing between "arms the
    // command pane" and "is a second Run button".
    expect(dynamic, "a command id is computed rather than named").toBe(0);
  });

  it("issues no paid command, ever", () => {
    /*
      The panel's whole claim. Its three arm buttons call `onArm`, which selects
      a catalogue command and fills its fields — the operator still presses Run,
      which is the one ember affordance on the screen and the only thing that
      settles an amount.

      If someone later wires an arm button straight through to `act("challenge",
      …)` it will look like a convenience and will be a second place money
      leaves. This fails on that line.
    */
    const offenders = literals.filter((id) => paid.has(id));
    expect(offenders, `these are paid: ${offenders.join(", ")}`).toEqual([]);
  });

  it("issues only commands that exist in the catalogue", () => {
    const known = new Set(COMMANDS.map((c) => c.id));
    const unknown = literals.filter((id) => !known.has(id));
    expect(unknown, `not in the catalogue: ${unknown.join(", ")}`).toEqual([]);
  });

  it("runs no clock — no countdown against the window's deadline", () => {
    // `closesAt` is rendered as the arena wrote it, beside the time of the read.
    // A countdown here would be the window rule reimplemented in a browser, and
    // on the day the two disagree the one on this screen is the wrong one. The
    // same rule is stated in `seat-state.tsx` and `action-picker.tsx`.
    const source = read(PANE)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\/.*$/gm, "");
    expect(source, "a countdown timer").not.toMatch(/setTimeout|Date\.now\(\)|getTime\(\)/);
  });
});

describe("a keyless deploy is told why, in the server's own words", () => {
  const reason = "Read-only: this deploy holds no key, so nothing here can prove a wallet.";
  const html = render({ enabled: false, reason });

  it("renders the capability's reason verbatim", () => {
    // Never a sentence invented here. Whether this deploy can prove a wallet is
    // a fact the server established; a browser that worked it out for itself
    // would be a second implementation of the rules.
    expect(html).toContain(reason);
  });

  it("cannot read the stable", () => {
    /*
      Every button that can REACH SOMETHING is disabled. View controls are not,
      and must not be: collapsing a panel or opening a legend touches no wallet
      and no network, and a keyless deploy that could not fold its own cards
      would be punishing the operator for the absence of a key.

      `aria-expanded` is the discriminator, and it is the honest one rather than
      a convenience — it is precisely the attribute that marks a control whose
      whole effect is on what is shown. A future button that reaches the arena
      will not carry it, and will land back under this assertion.
    */
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    const reaching = buttons.filter((b) => !b.includes("aria-expanded"));
    expect(buttons.length).toBeGreaterThan(0);
    expect(reaching.length, "no reaching button rendered — the test proves nothing").toBeGreaterThan(
      0,
    );
    for (const button of reaching) {
      expect(button, `a button is live on a keyless deploy: ${button}`).toContain("disabled");
    }
  });

  it("offers nothing to submit before a fighter is chosen", () => {
    expect(html).not.toContain("Submit the plan");
  });
});

describe("a keyed deploy can start", () => {
  const html = render({ enabled: true });

  it("offers the stable read and says what it costs", () => {
    expect(html).toContain("Read my stable");
    // The Stable is signed, not paid, and the empty state says so — cost is the
    // access model and it is rendered rather than assumed.
    expect(html).toContain("costs a signature and no money");
  });

  it("renders no ember Run affordance of its own", () => {
    // `command-pane.tsx` owns `className="run"`. One button on this screen
    // settles an amount; `globals.css`'s first paragraph is what that colour
    // means, and it is enforced socially everywhere except here.
    expect(html).not.toMatch(/class="[^"]*\brun\b[^"]*"/);
  });
});
