/**
 * The eight Houses, by slug.
 *
 * ## Why this is a read and not a table
 *
 * `masthead.tsx` already makes the argument for the crest path — *"a lookup
 * table would be a second enumeration of the eight, free to drift from a list
 * this console does not own"* — and it applies with more force to the names.
 * `GET /api/houses` publishes slug, name and words together, is free, and is
 * already in the catalogue. Hard-coding `ash-stadium → House Cindermark` here
 * would put the arena's naming in a second place, and the day a House is renamed
 * this console would be the one printing the old name over the right crest.
 *
 * Eight rows, one read, so there is no paging question and no cache to age.
 */

export interface House {
  slug: string;
  name: string;
  words: string | null;
}

/**
 * A slug → House map out of `/api/houses`.
 *
 * A row without both a slug and a name is skipped rather than half-rendered: a
 * crest with no name beside it is a decoration, and this exists to replace a
 * slug with a name.
 */
export function readHouses(body: unknown): Map<string, House> {
  const o = (body ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(o.houses) ? o.houses : [];
  const out = new Map<string, House>();
  for (const entry of raw) {
    const h = (entry ?? {}) as Record<string, unknown>;
    const slug = typeof h.slug === "string" ? h.slug : null;
    const name = typeof h.name === "string" ? h.name : null;
    if (!slug || !name) continue;
    out.set(slug, { slug, name, words: typeof h.words === "string" ? h.words : null });
  }
  return out;
}

/**
 * The crest for a slug, or null.
 *
 * `/houses/{slug}.webp`, matching `masthead.tsx` exactly — including its two
 * warnings, which are easy to lose in a copy: the file names keep the article
 * for `the-canopy` and `the-terminal` because their slugs do, and these must be
 * a plain `<img>` rather than `next/image`, because the optimizer FLATTENS the
 * alpha channel these assets rely on.
 */
export function crestFor(slug: string | null | undefined): string | null {
  // Anchored to the shape a slug actually has, because this value goes into a
  // URL. A slug from a body this console did not write should not be able to
  // reach for a path with a slash or a dot in it.
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return null;
  return `/houses/${slug}.webp`;
}
