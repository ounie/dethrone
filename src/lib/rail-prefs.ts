import type { Command } from "./commands";

/**
 * How the operator wants the catalogue arranged: which tier sits on top, and
 * which endpoints they keep to hand.
 *
 * ## Both are arrangement, and arrangement is remembered
 *
 * `lib/layout.ts` draws the line this file sits on: `panel.tsx` refuses to
 * persist a COLLAPSED panel because a folded card hides a money readout from
 * somebody who forgot folding it, while a moved card hides nothing. The same
 * test applies here and both halves pass it — reordering the tiers moves every
 * command and hides none, and a pin ADDS a row without removing one. A pinned
 * command still appears under its own tier, and the tier counts still say how
 * many commands exist rather than how many are unpinned.
 *
 * If a pin ever becomes a filter — "show only these" — it stops being
 * arrangement and the persistence has to be reconsidered with it.
 *
 * ## Cost still groups the catalogue
 *
 * The tiers can be reordered; they cannot be merged, renamed or hidden.
 * `rail.tsx` states why: cost is the only access control in this system, so the
 * left column IS the permission model rendered, and a catalogue that let a paid
 * write sit inside "Free reads" would be lying about the one thing it exists to
 * say. Order is presentation. Grouping is not.
 */

export type Tier = Command["tier"];

export const TIERS: readonly Tier[] = ["free", "paid", "signed"] as const;

/**
 * A heading in the rail: the three price tiers, plus the pinned shelf.
 *
 * `pinned` is in the ORDER but is not a tier, and the distinction is the point.
 * Cost is the only access control in this system, so the three tiers are the
 * permission model rendered and can never be merged, renamed or hidden. The
 * shelf is a shortcut over the same commands — it holds no command that is not
 * also under its own tier — so it can sit anywhere in the column without
 * claiming anything about price.
 */
export type SectionId = Tier | "pinned";

export const SECTIONS: readonly SectionId[] = ["pinned", "free", "paid", "signed"] as const;

/** Pinned on top, then the order the catalogue was written in. */
export const DEFAULT_SECTION_ORDER: readonly SectionId[] = [
  "pinned",
  "free",
  "paid",
  "signed",
] as const;

export interface RailPrefs {
  sectionOrder: SectionId[];
  /** Command ids, in the order they were pinned. */
  pinned: string[];
}

export const DEFAULT_PREFS: RailPrefs = {
  sectionOrder: [...DEFAULT_SECTION_ORDER],
  pinned: [],
};

const KEY = "dethrone.console.rail.v1";

/** A pin is a shortcut, not a workspace. Past this it stops being one. */
export const MAX_PINNED = 12;

function isSection(value: unknown): value is SectionId {
  return typeof value === "string" && (SECTIONS as readonly string[]).includes(value);
}

/**
 * Coerce anything into a complete, duplicate-free set of preferences.
 *
 * The property that matters is the same one `layout.ts#normalise` guards: a
 * section missing from storage — because it was added in a later release — is
 * restored rather than dropped, so a whole class of commands cannot become
 * invisible to somebody who arranged their rail before it existed.
 *
 * A missing section is inserted at its DEFAULT INDEX rather than appended.
 * `pinned` was added after `tierOrder` shipped, and appending would have moved
 * every existing operator's shelf to the bottom of the column — a preference
 * nobody expressed, applied silently on upgrade. At its default index it lands
 * back on top, where it has always been.
 *
 * `tierOrder` is still read, because that is what the shipped key holds. An
 * operator who put paid writes first keeps them first.
 *
 * Pinned ids are NOT validated against the catalogue here, because this module
 * would then need to import it as a value and the catalogue is the larger
 * thing. `rail.tsx` resolves ids to commands and silently drops what it cannot
 * find, which handles a renamed command the same way.
 */
export function normalisePrefs(value: unknown): RailPrefs {
  const raw = (value ?? {}) as Record<string, unknown>;

  const stored = Array.isArray(raw.sectionOrder)
    ? raw.sectionOrder
    : Array.isArray(raw.tierOrder)
      ? raw.tierOrder
      : [];

  const order: SectionId[] = [];
  for (const t of stored) {
    if (isSection(t) && !order.includes(t)) order.push(t);
  }
  for (const section of DEFAULT_SECTION_ORDER) {
    if (order.includes(section)) continue;
    const at = DEFAULT_SECTION_ORDER.indexOf(section);
    order.splice(Math.min(at, order.length), 0, section);
  }

  const pinned: string[] = [];
  for (const id of Array.isArray(raw.pinned) ? raw.pinned : []) {
    if (typeof id === "string" && id && !pinned.includes(id)) pinned.push(id);
    if (pinned.length >= MAX_PINNED) break;
  }

  return { sectionOrder: order, pinned };
}

export function loadPrefs(): RailPrefs {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_PREFS;
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    return normalisePrefs(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Move a section one place. Returns the SAME object at an edge, so a caller can tell. */
export function nudgeSection(
  prefs: RailPrefs,
  section: SectionId,
  direction: "up" | "down",
): RailPrefs {
  const from = prefs.sectionOrder.indexOf(section);
  if (from === -1) return prefs;
  const to = from + (direction === "up" ? -1 : 1);
  if (to < 0 || to >= prefs.sectionOrder.length) return prefs;
  const next = [...prefs.sectionOrder];
  next.splice(from, 1);
  next.splice(to, 0, section);
  return { ...prefs, sectionOrder: next };
}

/** Drop `section` in front of `before`, or at the end. The pointer path. */
export function moveSection(
  prefs: RailPrefs,
  section: SectionId,
  before: SectionId | null,
): RailPrefs {
  if (!prefs.sectionOrder.includes(section)) return prefs;
  const next = prefs.sectionOrder.filter((t) => t !== section);
  const at = before ? next.indexOf(before) : -1;
  if (at === -1) next.push(section);
  else next.splice(at, 0, section);
  return { ...prefs, sectionOrder: next };
}

/**
 * Pin or unpin, newest last.
 *
 * At the cap the OLDEST pin is dropped rather than the new one refused. A
 * shortcut list that silently stops accepting shortcuts reads as broken; one
 * that rolls is a list.
 */
export function togglePin(prefs: RailPrefs, id: string): RailPrefs {
  if (prefs.pinned.includes(id)) {
    return { ...prefs, pinned: prefs.pinned.filter((p) => p !== id) };
  }
  const next = [...prefs.pinned, id];
  return { ...prefs, pinned: next.slice(Math.max(0, next.length - MAX_PINNED)) };
}

// ── The store, read through `useSyncExternalStore` ──────────────────────────
//
// The server snapshot is the SHIPPED default, never storage: the server has no
// storage and no reader, and a client snapshot on the first pass is a hydration
// mismatch. It is also what keeps `catalogue-render.test.ts` exact — a static
// render has no pins, so the rows it counts are the catalogue's own.

let cached: RailPrefs = DEFAULT_PREFS;
let loaded = false;
const listeners = new Set<() => void>();

export function subscribeRailPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function railPrefsSnapshot(): RailPrefs {
  if (!loaded) {
    cached = loadPrefs();
    loaded = true;
  }
  return cached;
}

export function serverRailPrefsSnapshot(): RailPrefs {
  return DEFAULT_PREFS;
}

/** Persist and notify. Cached by identity — `useSyncExternalStore` compares that way. */
export function writePrefs(next: RailPrefs): void {
  cached = next;
  loaded = true;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Session-only. A degraded preference, never a broken catalogue.
  }
  for (const listener of listeners) listener();
}

export function resetPrefs(): void {
  writePrefs(DEFAULT_PREFS);
}
