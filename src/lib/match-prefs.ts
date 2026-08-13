/**
 * Two preferences for the match playback: auto-play, and sound.
 *
 * ## Why these are allowed to persist when a folded panel is not
 *
 * `panel.tsx` refuses to remember a fold, because *"a panel that came back
 * folded would hide a money readout from someone who had forgotten they folded
 * it three days earlier."* `layout.ts` makes the counter-argument for a
 * position: moving a card hides nothing.
 *
 * These sit on the same side of that line, and for a stronger reason: **neither
 * setting hides anything.** Auto-play off still renders the whole match — the
 * fighters, the window, the score, the coins, the verdict — and puts the reveal
 * one press away. Sound off removes no information at all. They change when and
 * how the reveal happens, never whether the card tells you what it knows.
 *
 * ## Read as an external store, exactly like `combos.ts`
 *
 * For the two reasons that file states at length. **Hydration:** the panel
 * server-renders, so a `useState` initialiser reading `localStorage` returns
 * false on the server and true on the client, and React finds markup that does
 * not match. **Cascading renders:** reading in an effect and calling `setState`
 * renders twice on every mount, which `react-hooks/set-state-in-effect` fails on
 * and is right to.
 *
 * Booleans are primitives, so the snapshots are identity-stable for free — the
 * cache `combos.ts` needs for its array is unnecessary here, and saying so is
 * what stops someone adding one back.
 *
 * ## Best-effort storage
 *
 * `localStorage` is absent server-side and throws outright in a private window.
 * A playback preference must never be able to take the console down, so every
 * path swallows and every reader returns a usable default.
 */

const AUTOPLAY_KEY = "dethrone.console.match.autoplay.v1";
const SOUND_KEY = "dethrone.console.match.sound.v1";

const listeners = new Set<() => void>();

function read(key: string, fallback: boolean): boolean {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === "true";
  } catch {
    return fallback;
  }
}

function write(key: string, value: boolean): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // A disabled store means the preference is session-only: degraded, not broken.
  }
  for (const listener of listeners) listener();
}

/**
 * Auto-play is off by default, deliberately.
 *
 * Every other panel in this console is still until it is acted on, and a card
 * that started animating on arrival would be the one exception. An operator who
 * wants it says so once; one who does not never has to notice the feature.
 *
 * Sound is off by default for a harder reason: a browser suspends an
 * `AudioContext` created outside a user gesture, so a console that defaulted to
 * sound-on would be silent anyway on the first load and would have lied in its
 * own toggle. Off is both the polite default and the honest one.
 */
export function autoplayEnabled(): boolean {
  return read(AUTOPLAY_KEY, false);
}

export function subscribeMatchPrefs(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function autoplaySnapshot(): boolean {
  return read(AUTOPLAY_KEY, false);
}

export function soundSnapshot(): boolean {
  return read(SOUND_KEY, false);
}

/** The server has no browser, so it has neither preference. */
export function serverFalse(): boolean {
  return false;
}

export function writeAutoplay(value: boolean): void {
  write(AUTOPLAY_KEY, value);
}

export function writeSound(value: boolean): void {
  write(SOUND_KEY, value);
}
