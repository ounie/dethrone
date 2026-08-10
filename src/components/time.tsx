"use client";

import { useSyncExternalStore } from "react";
import { localStamp, stamp, zoneLabel, zoneName } from "@/lib/format";

/**
 * One instant, rendered in the reader's own timezone.
 *
 * ## Why this is a component and not a call to `toLocaleString`
 *
 * The console renders on the server. A timestamp localised during that render
 * uses the SERVER's zone, which on a deploy is UTC and on a laptop is whatever
 * the laptop is — neither of which is a promise worth making. Localising in the
 * browser instead means the markup differs between the two passes, which is a
 * hydration mismatch: React discards the server's text, logs a warning, and the
 * bug shows up as a flicker nobody can reproduce.
 *
 * So the instant is rendered as the arena wrote it on the server, and swapped
 * for the reader's own zone once there is a reader. `useSyncExternalStore` with
 * a server snapshot of `false` is the same mechanism `lib/combos.ts` uses to
 * read `localStorage` — no effect, no `setState` during render, and the two
 * passes agree by construction because each is told which one it is.
 *
 * ## It still runs no clock
 *
 * `format.ts` refuses relative time — "3 minutes ago" keeps changing while the
 * data behind it does not, so a stale reading starts looking fresh. That
 * argument is about RELATIVE time and not about zones: this renders the same
 * instant the arena sent, in the reader's offset, and it is as static as the
 * UTC string it replaces. The zone is named beside it so nothing is ambiguous.
 */

/** Never fires. The answer changes exactly once, at hydration. */
const subscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

export default function Time({ iso, zone = true }: { iso: string; zone?: boolean }) {
  const hydrated = useSyncExternalStore(subscribe, onClient, onServer);

  if (!hydrated) {
    // The server pass, and the no-JS pass. UTC exactly as the arena wrote it.
    return <time dateTime={iso}>{stamp(iso)}</time>;
  }

  return (
    // Both precise answers in the tooltip: what the arena actually wrote, and
    // which zone this has been shifted into. The row shows the short form.
    <time dateTime={iso} title={`${stamp(iso)} · ${zoneName()}`}>
      {localStamp(iso)}
      {zone && <span className="time-zone">{zoneLabel()}</span>}
    </time>
  );
}
