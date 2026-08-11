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
      // The panel never renders this — it reads it only to notice that the
      // wallet changed, which is a client-side question a static render cannot
      // ask. `null` keeps these cases about the capability, as they were.
      operator: null,
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

function commandIdsIssued(): { literals: string[]; dynamic: number } {
  return callsNaming("act");
}

describe("the Fighters panel spends nothing", () => {
  const { literals, dynamic } = commandIdsIssued();
  const armed = callsNaming("onArm");
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

  it("arms only commands that exist in the catalogue", () => {
    /*
      The other half of the same question, and the one with no symptom.

      An `act()` with a bad id gets an error envelope back and the operator sees
      it. An `onArm()` with a bad id reaches `loadCommand`, whose `byId` returns
      undefined and which then RETURNS SILENTLY — a button that looks live,
      does nothing when pressed, and reports nothing. That is the failure this
      catches, and it is the reason the empty Stable's Forge button is worth a
      line here at all.
    */
    const known = new Set(COMMANDS.map((c) => c.id));
    const unknown = armed.literals.filter((id) => !known.has(id));
    expect(unknown, `armed but not in the catalogue: ${unknown.join(", ")}`).toEqual([]);
    expect(armed.dynamic, "a command id is computed rather than named").toBe(0);
  });

  it("offers a Forge from an empty Stable, and ARMS it rather than paying", () => {
    // Forge is paid. The empty state is the one place this panel can answer
    // directly — "your wallet already contains it" is literally true — and the
    // button must still put the command in front of the operator rather than
    // settle it. The paid-command assertion above is what enforces that; this
    // one is what stops the affordance quietly disappearing.
    expect(armed.literals).toContain("forge");
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

/**
 * The panel belongs to one wallet, and it outlives a change of wallet.
 *
 * `router.refresh()` re-renders the server tree and deliberately keeps client
 * state, so the roster, the chosen fighter, the menu, the plan and the match
 * watch all survive a switch unless something empties them. Two mechanisms do:
 * a render-time reset keyed on the operator, and an auto-open that runs once
 * per wallet rather than once per mount.
 *
 * Asserted off the AST rather than by mounting, for this file's stated reason —
 * the suite has no DOM, and adding one to ask this question would put a
 * lifecycle in a file that is otherwise about static output. The two things
 * pinned here are the two that stop working silently: a dependency array that
 * loses `operator` never re-reads, and a reset that loses a setter leaves one
 * wallet's object on another wallet's screen.
 */

/** Whether any descendant of `node` is an identifier with this name. */
function mentions(node: ts.Node, name: string): boolean {
  let found = false;
  const walk = (n: ts.Node) => {
    if (found) return;
    if (ts.isIdentifier(n) && n.text === name) found = true;
    else ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

/**
 * The forge watch reads the field that exists.
 *
 * A forged fighter came back `ready` on the arena and sat at "forging" in the
 * console until the watch gave up — because it polled `GET /api/character/{id}`
 * for a `state` that route does not publish. `body.state` was `undefined` on
 * every tick, the watch kept its own last value, and the bound eventually
 * printed "Stopped asking" over a finished portrait.
 *
 * It survived a browser check because that check stubbed the missing field. So
 * this is a source assertion rather than a behavioural one: the point is WHICH
 * ENDPOINT is asked, and no amount of exercising a fake can answer that.
 * `test/live/` is where the real shape is confirmed.
 */
describe("the forge watch asks the endpoint that carries a state", () => {
  const watchBody = () => {
    let found: string | null = null;
    const source = read(PANE);
    visitFile(PANE, (node) => {
      if (!ts.isCallExpression(node)) return;
      if (!ts.isIdentifier(node.expression) || node.expression.text !== "useCallback") return;
      const [body] = node.arguments;
      if (!body || !mentions(body, "setForging")) return;
      if (!mentions(body, "act")) return;
      found = source.slice(body.pos, body.end);
    });
    return found ?? "";
  };

  it("polls the Stable", () => {
    expect(watchBody(), "no forge-watch callback found").not.toBe("");
    expect(watchBody()).toContain('act("stable"');
  });

  it("does not poll the character route for a state it does not publish", () => {
    // `/api/character/{id}` answers identity, traits, actions and a record —
    // and no lifecycle state. Asking it for one reads `undefined` forever.
    expect(watchBody()).not.toMatch(/act\(\s*["'`]character["'`]/);
  });

  it("stops on anything that is not forging, rather than waiting for `ready`", () => {
    /*
      A forge can also end `void` — failed and refunded. Waiting specifically
      for `ready` would poll a refunded forge until the bound, then claim it was
      still forging.
    */
    expect(watchBody()).toMatch(/!==\s*["'`]forging["'`]/);
  });
});

describe("the panel does not carry one wallet's Stable into another's", () => {
  it("takes the operator as a prop", () => {
    // Never rendered. It is here so the panel can notice the wallet changed.
    expect(read(PANE)).toMatch(/operator:\s*string\s*\|\s*null/);
  });

  it("re-reads the Stable when the operator changes", () => {
    let found = false;
    visitFile(PANE, (node) => {
      if (!ts.isCallExpression(node)) return;
      if (!ts.isIdentifier(node.expression) || node.expression.text !== "useEffect") return;
      /*
        The auto-open effect, identified by the ref that makes it once-per-
        wallet — not merely by calling `loadRoster`, which the FORGE watch also
        does. Keying on `loadRoster` alone silently moved this assertion onto
        the forge effect the day that was added, and the forge effect has no
        business depending on `operator`.
      */
      const [body, deps] = node.arguments;
      if (!body || !mentions(body, "openedFor")) return;
      if (!deps || !ts.isArrayLiteralExpression(deps)) return;
      found = deps.elements.some((e) => ts.isIdentifier(e) && e.text === "operator");
    });
    expect(
      found,
      "the auto-open effect does not depend on `operator`, so a switch would leave the previous Stable on screen",
    ).toBe(true);
  });

  it("clears every piece of the previous wallet's state", () => {
    /*
      The plan (`setPicks`) and the watch (`setWatch`) matter most, for
      different reasons. A plan is a list of MENU INDICES, so carrying five of
      them to a fighter another wallet owns submits five legal integers naming
      five different moves — `combos.ts` makes exactly this argument about why
      saved combos store action ids instead. A watch is a match the previous
      wallet is in, which the new one cannot sign for.
    */
    const cleared = new Set<string>();
    visitFile(PANE, (node) => {
      if (!ts.isIfStatement(node)) return;
      const cond = node.expression;
      if (!ts.isBinaryExpression(cond)) return;
      if (cond.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken) return;
      if (!ts.isIdentifier(cond.left) || cond.left.text !== "operator") return;

      const collect = (n: ts.Node) => {
        if (
          ts.isCallExpression(n) &&
          ts.isIdentifier(n.expression) &&
          /^set[A-Z]/.test(n.expression.text)
        ) {
          cleared.add(n.expression.text);
        }
        ts.forEachChild(n, collect);
      };
      collect(node.thenStatement);
    });

    for (const setter of [
      "setRoster",
      "setSelected",
      "setMenu",
      "setPicks",
      "setWatch",
      "setSubmitNote",
    ]) {
      expect(cleared.has(setter), `a wallet switch does not clear ${setter}`).toBe(true);
    }
  });

  it("does not clear saved combos, which are not a fact about a wallet", () => {
    // They live in localStorage and store stable action ids rather than
    // indices. They are the operator's own vocabulary, and survive on purpose.
    expect(read(PANE)).not.toMatch(/writeCombos\(\s*\[\s*\]\s*\)/);
  });
});
