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

/**
 * Written once and read by all three of the sound accessors below, because a
 * default that disagreed with itself between the SSR snapshot and the client
 * one is a hydration mismatch rather than a preference.
 *
 * The key keeps its `.v1` suffix on purpose: this changes what an operator who
 * has never chosen gets, and must NOT overwrite the choice of one who has. A
 * stored "false" still wins.
 */
const SOUND_DEFAULT = true;

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
 * ## Sound is ON by default, and the old objection has been answered
 *
 * It used to be off for a reason that had nothing to do with politeness: a
 * browser suspends an `AudioContext` created outside a user gesture, so a
 * console defaulting to sound-on would have been silent on the first load and
 * would have lied in its own toggle. That was true of a toggle alone.
 *
 * `MatchSound.prime()` answers it. The pane spends the operator's first click
 * anywhere in the console on building and resuming the context, silently, long
 * before any verdict lands — so by the time a playback runs the permission is
 * held and "on" means audible. A default that cannot make a sound is a lie; a
 * default that can is just a default, and the fight this console watches is
 * worth hearing without asking for it twice.
 *
 * Off is one click away and persists, which is the whole point of this file.
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
  return read(SOUND_KEY, SOUND_DEFAULT);
}

/** The server has no browser, so auto-play is off there and everywhere else. */
export function serverFalse(): boolean {
  return false;
}

/**
 * The SSR snapshot for sound, which must be the client's default rather than
 * `false`.
 *
 * `useSyncExternalStore` renders the server snapshot through hydration and only
 * then adopts the client's. Returning false here would print "Sound off" on
 * every first paint and flip it a frame later — a control that visibly changes
 * its own mind before anyone touches it. Matching the default means only an
 * operator who has actually turned sound OFF sees a correction, which is the
 * one case where the correction is the truth.
 */
export function serverSound(): boolean {
  return SOUND_DEFAULT;
}

export function writeAutoplay(value: boolean): void {
  write(AUTOPLAY_KEY, value);
}

export function writeSound(value: boolean): void {
  write(SOUND_KEY, value);
}
