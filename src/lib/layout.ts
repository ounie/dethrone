/**
 * Where each card sits, and the operator's right to move it.
 *
 * ## Why this is persisted when collapsing is not
 *
 * `panel.tsx` states, at length, that a folded panel is deliberately NOT
 * remembered: *"a panel that came back folded would hide a money readout from
 * someone who had forgotten they folded it three days earlier. Every reload
 * shows the whole instrument."*
 *
 * An arrangement is the other side of that line and the distinction is the
 * whole justification for this file. **Folding hides a card; moving one does
 * not.** Every panel is still on screen, still open, still showing its numbers
 * — they are in a different order. Nothing can be forgotten into invisibility,
 * so the argument that forbids remembering a fold does not reach a position.
 *
 * If that ever stops being true — if an arrangement gains a "hide this pane"
 * — the persistence has to go with it.
 *
 * ## The rail is not in here
 *
 * `.pane-rail` is `position: sticky` and holds a viewport-sized scrolling list.
 * Anything that lands underneath it is painted over the moment the page scrolls
 * past — that is a bug this repo has already shipped once, and `globals.css`
 * carries the warning. So the catalogue is not a movable card and there is no
 * zone it can be moved to; the arrangement covers the content panes only.
 *
 * ## Storage is best-effort, exactly like `combos.ts`
 *
 * `localStorage` is absent server-side and throws outright in a private window.
 * A layout preference must never be able to take the console down, so every
 * path here returns a usable arrangement rather than raising.
 */

/** A pane that can be moved. The rail is deliberately absent. */
export type PaneId =
  | "fighters"
  | "chat"
  | "command"
  | "response"
  | "log"
  | "seat"
  | "standing"
  | "duels"
  | "cards"
  | "match";

/**
 * The three places a card can live.
 *
 * `wide` spans both content columns and is where the Fighters panel starts —
 * its roster and its sixteen-action menu were laid out for that width. It is a
 * zone rather than a property of one pane, so anything can be dropped there and
 * Fighters can be moved out of it.
 */
export type ZoneId = "wide" | "left" | "right";

export const ZONES: readonly ZoneId[] = ["wide", "left", "right"] as const;

export type Arrangement = Record<ZoneId, PaneId[]>;

/** Human names, for the drag handle's label and the keyboard hints. */
export const PANE_TITLES: Record<PaneId, string> = {
  fighters: "Fighters",
  chat: "Agent",
  command: "Command",
  response: "Response",
  log: "Response log",
  seat: "Seat",
  standing: "Your standing",
  duels: "Duel pool",
  cards: "House Cards",
  match: "Match",
};

export const ZONE_TITLES: Record<ZoneId, string> = {
  wide: "the full-width row",
  left: "the left column",
  right: "the right column",
};

/**
 * The shipped arrangement, and the one a fresh clone renders.
 *
 * It reproduces the grid this console had before cards could move: Fighters
 * across the top, the cause-things column (ask → command → what happened) on
 * the left, the see-things column (response → seat → standing) on the right.
 * `reset()` returns exactly this.
 */
export const DEFAULT_ARRANGEMENT: Arrangement = {
  // Fighters first, then the match beneath it — both want the full width: the
  // roster and the sixteen-action menu were laid out for it, and the judge panel
  // is two fighters facing each other across five exchanges.
  wide: ["fighters", "match"],
  left: ["chat", "command", "log"],
  // The pool sits under the standing, at the foot of the see-things column. It
  // is a read like the three above it, and it belongs beside "your duels" on
  // the standing card rather than in the column where things are caused — its
  // "Take this" arms the command pane in the OTHER column, which is the same
  // direction the Fighters panel's arm row already points.
  // House Cards sit under the pool for the same reason the pool sits under the
  // standing: both are reads of what the arena is offering, and both arm a
  // command in the OTHER column rather than acting here.
  right: ["response", "seat", "standing", "duels", "cards"],
};

const KEY = "dethrone.console.layout.v1";

const ALL_PANES = Object.keys(PANE_TITLES) as PaneId[];

function isPaneId(value: unknown): value is PaneId {
  return typeof value === "string" && (ALL_PANES as string[]).includes(value);
}

/**
 * Coerce anything into a complete, duplicate-free arrangement.
 *
 * Two properties matter more than the parsing, and both are about a stored
 * value outliving the code that wrote it:
 *
 *  - **Every pane appears exactly once.** A pane missing from storage — because
 *    it was added in a later release — is appended rather than dropped, so a
 *    new card cannot be invisible to anyone who arranged their console before
 *    it existed. That is the failure this function is really for.
 *  - **A pane that no longer exists is discarded**, so a removed card cannot
 *    leave a hole or a crash behind.
 */
export function normalise(value: unknown): Arrangement {
  const raw = (value ?? {}) as Partial<Record<ZoneId, unknown>>;
  const out: Arrangement = { wide: [], left: [], right: [] };
  const seen = new Set<PaneId>();

  for (const zone of ZONES) {
    const list = Array.isArray(raw[zone]) ? (raw[zone] as unknown[]) : [];
    for (const id of list) {
      if (!isPaneId(id) || seen.has(id)) continue;
      seen.add(id);
      out[zone].push(id);
    }
  }

  // Anything the stored value never mentioned lands where it ships by default,
  // which keeps a new pane beside the panes it belongs with rather than at the
  // bottom of whichever column happens to be first.
  for (const zone of ZONES) {
    for (const id of DEFAULT_ARRANGEMENT[zone]) {
      if (!seen.has(id)) {
        seen.add(id);
        out[zone].push(id);
      }
    }
  }

  return out;
}

export function loadArrangement(): Arrangement {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_ARRANGEMENT;
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_ARRANGEMENT;
    return normalise(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_ARRANGEMENT;
  }
}

/** Where a pane currently is, or null if it somehow is not anywhere. */
export function locate(
  arrangement: Arrangement,
  pane: PaneId,
): { zone: ZoneId; index: number } | null {
  for (const zone of ZONES) {
    const index = arrangement[zone].indexOf(pane);
    if (index !== -1) return { zone, index };
  }
  return null;
}

/**
 * Move a pane to a zone, before the pane named by `before` (or to the end).
 *
 * Pure, so the whole reordering rule is testable without a DOM — which matters
 * because the alternative is asserting on drag events, and a drag is the one
 * interaction a unit test cannot honestly reproduce.
 */
export function move(
  arrangement: Arrangement,
  pane: PaneId,
  zone: ZoneId,
  before: PaneId | null,
): Arrangement {
  const next: Arrangement = {
    wide: arrangement.wide.filter((p) => p !== pane),
    left: arrangement.left.filter((p) => p !== pane),
    right: arrangement.right.filter((p) => p !== pane),
  };

  const target = next[zone];
  // `before` is the card the pointer was over. A pane dropped onto itself, or
  // onto a card that has just been removed from this list, falls through to the
  // end rather than being lost.
  const at = before ? target.indexOf(before) : -1;
  if (at === -1) target.push(pane);
  else target.splice(at, 0, pane);

  return next;
}

/** One step in a direction, for the keyboard. Returns the same object if it cannot. */
export function nudge(
  arrangement: Arrangement,
  pane: PaneId,
  direction: "up" | "down" | "left" | "right",
): Arrangement {
  const at = locate(arrangement, pane);
  if (!at) return arrangement;
  const list = arrangement[at.zone];

  if (direction === "up" || direction === "down") {
    const to = at.index + (direction === "up" ? -1 : 1);
    if (to < 0 || to >= list.length) return arrangement;
    const reordered = [...list];
    reordered.splice(at.index, 1);
    reordered.splice(to, 0, pane);
    return { ...arrangement, [at.zone]: reordered };
  }

  /*
    Sideways walks wide → left → right and stops at each end.

    Not a wrap: a card that leaps from the right column to the full-width row
    because somebody pressed → once too often has moved somewhere they did not
    ask for, and the correction is another four keystrokes away.
  */
  const order: ZoneId[] = ["wide", "left", "right"];
  const from = order.indexOf(at.zone);
  const to = from + (direction === "left" ? -1 : 1);
  if (to < 0 || to >= order.length) return arrangement;
  return move(arrangement, pane, order[to], null);
}

// ── The store, read through `useSyncExternalStore` ──────────────────────────
//
// Same shape as `lib/combos.ts`. The server snapshot is the DEFAULT rather than
// whatever is in storage, because the server has no storage and no reader — a
// client snapshot on the first pass is a hydration mismatch, and the symptom is
// cards flickering into place rather than an error anybody would notice.

let cached: Arrangement = DEFAULT_ARRANGEMENT;
let loaded = false;
const listeners = new Set<() => void>();

export function subscribeLayout(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function layoutSnapshot(): Arrangement {
  if (!loaded) {
    cached = loadArrangement();
    loaded = true;
  }
  return cached;
}

/** The server's answer, and the pre-hydration one. Always the shipped default. */
export function serverLayoutSnapshot(): Arrangement {
  return DEFAULT_ARRANGEMENT;
}

/**
 * Persist and notify.
 *
 * The cache is replaced with the object that was written rather than re-read,
 * because `useSyncExternalStore` compares snapshots by identity — returning a
 * freshly parsed object on every read would re-render forever.
 */
export function writeArrangement(next: Arrangement): void {
  cached = next;
  loaded = true;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Session-only, as `combos.ts` puts it: a degraded preference, not a broken
    // console.
  }
  for (const listener of listeners) listener();
}

export function resetArrangement(): void {
  writeArrangement(DEFAULT_ARRANGEMENT);
}
