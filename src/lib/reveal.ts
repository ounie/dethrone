/**
 * Bring a pane into view after a settled command put something in it.
 *
 * ## Why a shared module rather than a `scrollIntoView` at each call site
 *
 * `command-pane.tsx` already scrolls, in an effect keyed on `armedAt`, and it
 * does more than move the page — it focuses the first empty field and flashes
 * the panel. That one stays where it is. This is the other half: after a
 * command SETTLES, the operator's attention belongs on the card that now holds
 * what they paid for, and two panes need the same treatment from one caller.
 *
 * The selectors live here beside the function that uses them for the reason the
 * Gate's `COMMAND_ANCHOR` gives: a class named in two files is a scroll that
 * silently stops working the day one of them is renamed. Nothing throws — the
 * element is simply not found and the page does not move.
 *
 * ## Panes move, so this looks them up rather than remembering where they are
 *
 * Cards are arranged by the operator (`lib/layout.ts`), so a pane can be in any
 * zone and no position can be written down. A class search finds it wherever it
 * currently sits.
 */

/** The Fighters pane. Also on the panel itself — see `fighters-pane.tsx`. */
export const FIGHTERS_PANE = "pane-fighters";
/** The Match pane. Also on the panel itself — see `match-pane.tsx`. */
export const MATCH_PANE = "pane-match";

/**
 * Smooth unless the operator has asked for less motion, which is the one place
 * `prefers-reduced-motion` cannot be honoured in CSS.
 *
 * `block: "start"` rather than `"nearest"`: the point is to bring a card the
 * operator was not looking at onto the screen. `command-pane.tsx` uses
 * `"nearest"` for the opposite case — a pane already in view that must not jump.
 */
function reveal(selector: string): void {
  if (typeof document === "undefined") return;
  const el = document.querySelector(`.${selector}`);
  if (!el) return;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
}

/** Which pane a settled command's answer belongs in, or null for neither. */
export type ResultPane = "fighters" | "match";

/**
 * The pane a settled command's result landed in.
 *
 * **Read off the RESPONSE, never off the command that was run** — the law
 * `absorb()` already states about the same two fields. The console does not
 * decide that a forge happened; the arena says so, by answering with a
 * character id.
 *
 * `matchId` is tested FIRST, and the order is the whole trick: entering the
 * throne answers with BOTH, because the match is the new thing and the
 * character id says which fighter entered it. Testing the character first sends
 * every paid entry to the Fighters pane, which is the one place it does not
 * belong. Taking a VACANT throne is deliberately shaped like a forge instead —
 * the arena's `seatedResponse` carries no `matchId`, "because there is no
 * match" — so it lands on Fighters, the only pane with anything to show.
 *
 * Pure, and separate from the scroll, so the precedence above is a test rather
 * than a comment. It is the part that was wrong first.
 */
export function resultPaneFor(body: unknown): ResultPane | null {
  const answer = body as { characterId?: unknown; matchId?: unknown } | null | undefined;
  if (typeof answer?.matchId === "string") return "match";
  if (typeof answer?.characterId === "number") return "fighters";
  return null;
}

/** Move to whichever pane the answer named, or stay put. */
export function revealResultPane(body: unknown): void {
  const pane = resultPaneFor(body);
  if (pane === "match") reveal(MATCH_PANE);
  else if (pane === "fighters") reveal(FIGHTERS_PANE);
}
