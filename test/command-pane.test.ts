import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { SRC, read, ts, visitFile } from "./graph";

/**
 * The command pane announces that it was filled, and never acts on it.
 *
 * Four buttons elsewhere on the screen fill this card without touching it —
 * three in the Fighters panel, one on an agent proposal — and on a desktop
 * layout the card is often not where the operator is looking. Pressing Forge
 * therefore read as a button that did nothing, when in fact it had rewritten a
 * different card. So the pane now scrolls itself into view and flashes.
 *
 * That fix has one obvious next step and it is the dangerous one: if bringing
 * the card into view is good, pressing its button must be better. It is not.
 * `Run` is the single ember affordance on this screen and the only thing that
 * settles an amount; arming is a keystroke away from paying precisely because
 * a human decides in between. These cases exist to make that a failing test
 * rather than a paragraph.
 */

const PANE = join(SRC, "components/command-pane.tsx");
const CSS = join(SRC, "app/globals.css");

/** The body of the effect that reacts to a fresh arming, as source text. */
function armedEffectBody(): string {
  let found: string | null = null;
  const source = read(PANE);
  visitFile(PANE, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (!ts.isIdentifier(node.expression) || node.expression.text !== "useEffect") return;
    const [body, deps] = node.arguments;
    if (!body || !deps || !ts.isArrayLiteralExpression(deps)) return;
    if (!deps.elements.some((e) => ts.isIdentifier(e) && e.text === "armedAt")) return;
    found = source.slice(body.pos, body.end);
  });
  return found ?? "";
}

describe("arming brings the card to the operator", () => {
  it("reacts to a fresh arming", () => {
    // Keyed on a counter and not a boolean: arming the SAME command twice has
    // to be as visible as arming a different one, and a boolean already true
    // says nothing the second time.
    expect(armedEffectBody(), "no effect depends on `armedAt`").not.toBe("");
    expect(read(PANE)).toContain("scrollIntoView");
  });

  it("presses nothing", () => {
    /*
      The whole point. An armed command is one deliberate press from settling an
      amount, and the person who presses it has to be a person. A `.click()`
      here, or a call to `onRun`, would turn a button in another pane into a
      payment — the same defect `test/fighters-pane.test.ts` guards from the
      other side, where the arm buttons must not call `act()` directly.
    */
    const body = armedEffectBody();
    expect(body, "the arming effect runs the command").not.toMatch(/\bonRun\b/);
    expect(body, "the arming effect clicks something").not.toMatch(/\.click\s*\(/);
    expect(body, "the arming effect submits a form").not.toMatch(/\.submit\s*\(/);
  });

  it("does not put focus on the Run button", () => {
    /*
      Softer than pressing it, and still wrong. A focused ember button is one
      Space or Enter from settling, and the operator most likely to hit that is
      the one whose hands are already on the keyboard because they were typing a
      stake. The effect focuses the first EMPTY input instead — the thing they
      have to do next anyway, on an element that cannot spend.
    */
    const body = armedEffectBody();
    expect(body).toContain("focus");
    expect(body, "the arming effect reaches for the run button").not.toMatch(/["'`.]run\b/);
    // The focus target is chosen by being empty, not by being first on the page.
    expect(body).toMatch(/value\s*===\s*""/);
  });
});

describe("the highlight says 'look here', never 'this cost money'", () => {
  /** The `.pane-command[data-armed]` rule and the keyframes it names. */
  function highlightCss(): string {
    const css = read(CSS);
    const start = css.indexOf(".pane-command[data-armed]");
    expect(start, "the armed highlight rule is gone").toBeGreaterThan(-1);
    const end = css.indexOf("@keyframes armed-flash");
    const keyframesEnd = css.indexOf("}\n}", end);
    return css.slice(start, keyframesEnd);
  }

  it("is gold, and never ember", () => {
    // `globals.css`'s first paragraph spends ember on one meaning: this button
    // settles an amount NOW. A card glowing ember because it had been FILLED
    // would say the money already moved.
    expect(highlightCss()).not.toMatch(/--ember/);
    expect(highlightCss()).toMatch(/--gold-/);
  });

  it("survives prefers-reduced-motion as a static ring", () => {
    /*
      The global reset at the foot of `globals.css` kills every animation, so a
      cue that lived only in the keyframes would vanish for exactly the people
      most likely to need one. The ring is applied on the rule itself and the
      animation only fades it out — with motion off it simply stays for its
      1.4s and then goes with the attribute.
    */
    const rule = highlightCss().slice(0, highlightCss().indexOf("@keyframes"));
    expect(rule, "the ring lives only in the animation").toMatch(/box-shadow/);
  });

  it("fades for exactly as long as the attribute is set", () => {
    // Two declarations of one duration. When they disagree the highlight either
    // stops mid-fade or lingers as a static ring, and both read as a bug in the
    // animation rather than as the drift they are.
    const ms = /const ARMED_FLASH_MS = (\d+)/.exec(read(PANE))?.[1];
    expect(ms, "ARMED_FLASH_MS is gone or renamed").toBeTruthy();
    expect(highlightCss(), `the CSS does not animate for ${ms}ms`).toContain(`${ms}ms`);
  });
});
