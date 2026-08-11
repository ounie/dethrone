/**
 * Named sequences the operator saved, and the one hazard in the idea.
 *
 * ## A combo belongs to the fighter it was built from
 *
 * `fromCharacterId` is the OWNER, and the library is filtered by it: a combo
 * saved from #293 is offered on #293 and nowhere else.
 *
 * This used to be provenance only — every combo was offered on every fighter,
 * and applying one across fighters was handled by dropping the actions that did
 * not fit and reporting them. The mechanism was sound and the product was not.
 * Saving "combo 1" on one fighter and then finding it under a different one,
 * three of its five actions greyed out with a paragraph explaining why, is a
 * library that fills with entries that do not work where they are shown. The
 * warning was correct and still meant the panel was offering something it knew
 * would not fit.
 *
 * So the id filters. It follows that a NAME is unique per fighter rather than
 * globally — "combo 1" on #293 and "combo 1" on #500 are two different combos,
 * and saving one must not overwrite the other. Every function below that
 * identifies a combo therefore takes the character id alongside the name; a
 * name on its own is not an identity here.
 *
 * ## A combo is still stored by ACTION ID, never by index
 *
 * This is the whole design and it is not a detail. A submitted sequence is five
 * integers, but those integers are indices **into one fighter's menu**, and a
 * menu is a pure function of that fighter's genome. Two fighters have different
 * menus. So `[0, 5, 6, 7, 12]` saved from one fighter and replayed on another is
 * five perfectly legal integers describing five completely different actions —
 * a request the arena accepts and a fight nobody planned.
 *
 * That failure is silent, which is what makes it worth this much prose. The
 * indices are valid, the submission succeeds, and the first sign of trouble is a
 * verdict. So a combo stores the stable `id` of each action, and applying it
 * means looking each id up in the CURRENT fighter's menu.
 *
 * **The owner filter does not make this redundant, and removing it would be the
 * wrong lesson to draw.** The filter means a combo now meets the menu it was
 * built from, so a miss should be impossible — a menu is a pure function of a
 * genome and a genome does not change. That makes `applyCombo`'s `missing` an
 * invariant check rather than the ordinary case it used to be: if it ever fires,
 * the arena's menu derivation has versioned under a saved combo, and dropping
 * the slot and saying so is still the only honest response. Storing indices
 * would have made that same event silent and wrong instead of visible.
 *
 * ## Why this is not a standing sequence
 *
 * The arena has no standing-sequence mechanism, deliberately — one set at
 * coronation leaks after its first defense and is counter-picked for the rest of
 * a reign. Nothing here changes that. A combo is a local autofill: the arena
 * never sees it, nothing registers it against a match, no window consumes it,
 * and it reaches the canon only when a human presses Submit on a plan they can
 * see. It is a keyboard macro, not a commitment.
 *
 * ## Why localStorage is acceptable here, when the plan is not
 *
 * The in-flight plan is deliberately memory-only: it is bound to one match the
 * operator paid for, and a plan that outlived the tab would be a commitment
 * nobody re-read. A combo is bound to no match and no wallet. What is stored is
 * a name and a list of action ids — no key, no signature, no credential, no
 * address, and nothing that could be replayed by anyone who read it.
 */

/** Storage version, in the key. A shape change orphans old data rather than misreading it. */
const KEY = "dethrone.console.combos.v1";

/** A guard, not a policy. Enough rope for a real library, not enough to fill a quota. */
const MAX_COMBOS = 50;
const MAX_NAME = 60;

export interface Combo {
  name: string;
  /** Stable action ids, in exchange order. NOT menu indices — see the module note. */
  actionIds: string[];
  /**
   * Which fighter it was built from, and which fighter it is offered on.
   *
   * `null` means unowned, which this code no longer produces — `saveCurrentAsCombo`
   * cannot run without a selected fighter, since it needs that fighter's menu to
   * turn picks into ids. It stays in the type for data written before the field
   * existed, and `combosFor` deliberately offers such an entry on NO fighter:
   * an unowned combo is precisely the thing whose actions cannot be known to fit,
   * which is what the filter exists to stop.
   */
  fromCharacterId: number | null;
  savedAt: string;
}

/** What one menu needs to look like for a combo to be resolved against it. */
export interface MenuEntry {
  index: number;
  id: string;
}

export interface Applied {
  /** Menu indices, in order, for the ids this fighter actually has. */
  picks: number[];
  /** Ids the saved combo names that this fighter's menu does not contain. */
  missing: string[];
}

/**
 * Resolve a combo against a fighter's menu.
 *
 * Order is preserved for what matched, and a missing id is DROPPED rather than
 * substituted. Substituting would be the library quietly choosing an action —
 * the one thing an autofill must never do, because the operator would then be
 * submitting a plan they did not write and could not tell apart from one they
 * did.
 */
export function applyCombo(combo: Combo, menu: readonly MenuEntry[]): Applied {
  const byId = new Map(menu.map((a) => [a.id, a.index]));
  const picks: number[] = [];
  const missing: string[] = [];
  for (const id of combo.actionIds) {
    const index = byId.get(id);
    if (index === undefined) missing.push(id);
    else picks.push(index);
  }
  return { picks, missing };
}

/** Turn the current picks into storable ids. Unknown indices are skipped. */
export function comboFromPicks(
  picks: readonly number[],
  menu: readonly MenuEntry[],
): string[] {
  const byIndex = new Map(menu.map((a) => [a.index, a.id]));
  return picks.map((i) => byIndex.get(i)).filter((id): id is string => id !== undefined);
}

function isCombo(value: unknown): value is Combo {
  const c = value as Combo | null;
  return (
    !!c &&
    typeof c.name === "string" &&
    Array.isArray(c.actionIds) &&
    c.actionIds.every((id) => typeof id === "string") &&
    // Checked rather than assumed, because it is load-bearing now that it
    // filters. A hand-edited store carrying a string here would compare
    // unequal to every character id and the combo would silently never appear
    // — a saved thing that is gone with no error, which is the worst shape a
    // storage bug can take.
    (typeof c.fromCharacterId === "number" || c.fromCharacterId === null)
  );
}

/**
 * The combos belonging to one fighter.
 *
 * A `null` character id — no fighter selected — matches nothing rather than
 * matching the unowned entries described on `fromCharacterId`. There is no
 * screen that asks for combos without a fighter, and "no fighter" resolving to
 * "some combos" is the kind of accident that puts an unfitting library back in
 * front of the operator.
 */
export function combosFor(combos: readonly Combo[], characterId: number | null): Combo[] {
  if (characterId === null) return [];
  return combos.filter((c) => c.fromCharacterId === characterId);
}

/**
 * Everything saved, or an empty list.
 *
 * Never throws. `localStorage` is absent during server rendering and can throw
 * outright in a private window or with storage disabled, and a saved-macro
 * feature must not be able to take the panel down with it.
 */
export function loadCombos(): Combo[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isCombo).slice(0, MAX_COMBOS) : [];
  } catch {
    return [];
  }
}

/** Persist, best effort. Returns what the caller should now render. */
export function saveCombos(combos: Combo[]): Combo[] {
  const next = combos.slice(0, MAX_COMBOS);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A full or disabled store means the library is session-only. That is a
    // degraded feature, not a broken panel, and saying so would need a error
    // channel this has no room for.
  }
  return next;
}

/**
 * Add or replace, newest first. Trimming is the caller's input policy.
 *
 * Replacement is keyed on the character AND the name, not the name alone. With
 * the library filtered by fighter, a global name key would mean saving "combo 1"
 * on one fighter silently deleted the "combo 1" belonging to another — an entry
 * vanishing from a screen the operator was not looking at, caused by an action
 * that said "save".
 */
export function upsertCombo(combos: Combo[], combo: Combo): Combo[] {
  const name = combo.name.trim().slice(0, MAX_NAME);
  if (!name || combo.actionIds.length === 0) return combos;
  return [
    { ...combo, name },
    ...combos.filter((c) => !(c.name === name && c.fromCharacterId === combo.fromCharacterId)),
  ];
}

/** Remove one combo, identified the same way `upsertCombo` replaces one. */
export function removeCombo(
  combos: Combo[],
  characterId: number | null,
  name: string,
): Combo[] {
  return combos.filter((c) => !(c.name === name && c.fromCharacterId === characterId));
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/**
 * `localStorage` as an external store, read through `useSyncExternalStore`.
 *
 * Two problems this solves that an effect does not.
 *
 * **Hydration.** The panel server-renders. A `useState(() => loadCombos())`
 * initialiser runs on the server (where there is no `localStorage`, so: empty)
 * and again on the client during hydration (where there is one, so: not empty),
 * and React compares the two and finds the markup does not match. This split is
 * exactly what `getServerSnapshot` exists to express.
 *
 * **Cascading renders.** Reading in an effect and calling `setState` renders
 * twice on every mount, which the `react-hooks/set-state-in-effect` rule fails
 * on and is right to.
 *
 * `snapshot` must return a STABLE REFERENCE between writes — React compares by
 * identity and a fresh array every call is an infinite render loop. Hence the
 * cache, invalidated only by `writeCombos`.
 */
let cached: Combo[] | null = null;
const listeners = new Set<() => void>();

/**
 * The server's answer, and it must be the SAME ARRAY every call.
 *
 * `useSyncExternalStore` compares snapshots by identity, so returning a fresh
 * `[]` would look like a change on every render and loop forever.
 */
const NONE: Combo[] = [];

export function subscribeCombos(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function combosSnapshot(): Combo[] {
  return (cached ??= loadCombos());
}

export function serverCombosSnapshot(): Combo[] {
  return NONE;
}

/** Persist and notify. The one write path, so the cache cannot go stale. */
export function writeCombos(next: Combo[]): void {
  cached = saveCombos(next);
  for (const listener of listeners) listener();
}
