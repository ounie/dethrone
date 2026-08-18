"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./icon";
import Panel, { type PanelDrag } from "./panel";
import Time from "./time";
import type { Capabilities } from "@/lib/capability";
import { stakeToCents } from "@/lib/stake";

/**
 * The open duel pool, and the one thing to do about a row.
 *
 * ## Why this card exists at all
 *
 * `take_duel` needs a duel id, and until this card there was no way to learn one
 * except by hand: run the pool read from the catalogue, find `duelId` in the raw
 * JSON in the response pane, copy it, select "Take a duel", type it back in. An
 * operator reported that as the reason they had never taken one — which is a
 * console that holds a command it cannot practically reach.
 *
 * ## It reads and it arms. It does not spend.
 *
 * "Take this" calls `onArm`, which is `console.tsx`'s `loadCommand`: it selects
 * the catalogue's `take_duel` and fills its fields. The command pane still shows
 * every argument, the Run button is still the only control that settles an
 * amount, and a paid command still earns its 428 and the confirmation dialog.
 * `test/duels-pane.test.ts` reads this file's AST and fails if any `act(...)`
 * here ever names a `tier: "paid"` command — the same mechanism that fences the
 * Fighters panel, for the same reason.
 *
 * ## Nothing here is sorted, filtered or judged
 *
 * The console's first rule is that a UI which branches on game state is a second
 * implementation of the game, and a market list is where that starts: an
 * "affordable" badge, a cheapest-first default, a row greyed out because the
 * ceiling could not cover it. All three are the browser holding an opinion about
 * money, and all three would be wrong the day a rule versions.
 *
 * So the sort and the stake bounds are **the arena's own query parameters**,
 * passed through to `GET /api/duels/pool` and applied by the arena. This file
 * never reorders the array it was handed. The one thing it does is print the
 * listings in the order they arrived.
 *
 * ## Stakes are rendered, never formatted
 *
 * `stakeUsdc` is a string the arena wrote. It is printed exactly as received —
 * no parse, no re-format, no cents arithmetic. `lib/commands.ts` is the only
 * file under `src/` allowed a currency literal and this is not it.
 *
 * ## No relative time
 *
 * `format.ts` refuses "listed 4 minutes ago" on the grounds that a relative
 * stamp keeps moving while the data behind it does not, so a stale reading
 * starts to look fresh. `Time` renders the instant the arena sent, in the
 * reader's own zone. The header says *as of the last read* and means it.
 */

/** The single destination. `test/one-fetch.test.ts` wants a string literal. */
async function act(id: string, args: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch("/api/act", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, args }),
  });
  return (await res.json()) as Record<string, unknown>;
}

/**
 * One open listing, exactly as the pool publishes it.
 *
 * Four fields and no fifth. The pool read's own note says it: *"Listings show
 * arena, stake and age. Nothing about the fighter or the host."* The pool is
 * anonymous by design, and a card that displayed a host would be inventing one.
 */
interface Listing {
  duelId: number;
  arenaSlug: string;
  arenaName: string;
  stakeUsdc: string;
  listedAt: string;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * The listings out of an envelope, or null when the read did not produce any.
 *
 * Null and `[]` are deliberately different answers and the card renders them
 * differently. An empty pool and an unreachable arena look identical once a
 * failed read is flattened to an empty array — "there are no open duels" is a
 * claim, and this card only makes it when the arena actually said so. Same
 * argument `standing-pane.tsx` makes at length.
 */
function listingsOf(data: Record<string, unknown>): Listing[] | null {
  const body = data.body as { listings?: unknown } | undefined;
  if (!body || !Array.isArray(body.listings)) return null;

  const out: Listing[] = [];
  for (const raw of body.listings) {
    const row = raw as Record<string, unknown>;
    const duelId = row.duelId;
    const stakeUsdc = str(row.stakeUsdc);
    const listedAt = str(row.listedAt);
    const arenaSlug = str(row.arenaSlug);
    // A row missing any of these is not a row this card can render honestly, and
    // a blank cell reads as "the arena said nothing here" rather than "the shape
    // changed". Dropping it is the visible failure; a hole is the silent one.
    if (typeof duelId !== "number" || !stakeUsdc || !listedAt || !arenaSlug) continue;
    out.push({
      duelId,
      arenaSlug,
      // The arena's display name where it sent one. Never composed from the
      // slug here — `capability.ts` makes the same point about `ArenaChoice`.
      arenaName: str(row.arenaName) ?? arenaSlug,
      stakeUsdc,
      listedAt,
    });
  }
  return out;
}

/** The arena's own code, or the console's. Never a sentence invented here. */
function codeOf(data: Record<string, unknown>, fallback: string): string {
  const body = data.body as { error?: { code?: string } } | undefined;
  const err = data.error as { code?: string } | undefined;
  return body?.error?.code ?? err?.code ?? fallback;
}

export default function DuelsPane({
  capabilities,
  operator,
  disabled,
  selectedFighter,
  onArm,
  drag,
}: {
  capabilities: Capabilities;
  /**
   * The address currently signing, or null on a read-only deploy.
   *
   * Not rendered here. It is on the props because a listing this operator can
   * take is not a listing the NEXT one can — the pool is the same for everyone,
   * but the fighter about to be armed into `take_duel` belongs to one wallet.
   * See the reset beside the state declarations.
   */
  operator: string | null;
  /** True while any other request is in flight. */
  disabled: boolean;
  /**
   * The fighter currently open in the Fighters panel, prefilled into the armed
   * command — or null, which arms the duel id alone and leaves the operator to
   * name their fighter in the command pane.
   *
   * A guess, and a cheap one to correct: the command pane shows the field, and
   * nothing settles until Run. The alternative was a second roster read and a
   * second fighter picker on this card, which is one roster rendered twice and
   * two places for it to disagree.
   */
  selectedFighter: number | null;
  /** `console.tsx`'s `loadCommand`. Fills the command pane and stops. */
  onArm: (commandId: string, args: Record<string, string>) => void;
  drag?: PanelDrag;
}) {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [readAt, setReadAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
    The pool is not owned by this wallet, but the fighter armed off it is.

    Adjusted during render rather than in an effect — React's own prescription
    for resetting state when a prop changes, and the pattern `console.tsx` uses
    to drop a confirmation dialog on a wallet switch. Clearing the read as well
    as the arming is deliberate: a listing taken while wallet A was selected is
    still open or still gone regardless of who is signing, but the timestamp in
    the header claims a freshness that a switch just spent, and a stale market
    readout is the one this card must not leave standing.
  */
  const [signedAs, setSignedAs] = useState(operator);
  if (operator !== signedAs) {
    setSignedAs(operator);
    setListings(null);
    setReadAt(null);
    setError(null);
  }

  const cap = capabilities.pool;
  const takeCap = capabilities.take_duel;
  const readable = cap?.enabled ?? true;

  const read = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // No sort, no bounds, no limit. The arena's default order is the arena's
      // opinion about its own market and this card does not hold a better one;
      // the pool read in the catalogue carries the four parameters for an
      // operator who wants a different one.
      const data = await act("pool", {});
      const rows = listingsOf(data);
      if (rows === null) {
        setError(codeOf(data, "the_pool_could_not_be_read"));
        setListings(null);
      } else {
        setListings(rows);
      }
      setReadAt(new Date().toISOString());
    } catch {
      setError("the_console_could_not_be_reached");
      setListings(null);
    } finally {
      setBusy(false);
    }
  }, []);

  /*
    One read on mount, and never a poll.

    The pool is never cached and listings do get taken by other agents, which is
    an argument for a refresh button and NOT an argument for a timer: a list
    that re-reads itself every few seconds is a console holding a rate limit
    open on a market the operator may not be looking at, and the Fighters
    panel's own forge watch is deliberately bounded for the same reason. The
    header says as of the last read, and the button beside it is how you get
    another one.
  */
  useEffect(() => {
    if (!readable) return;
    // An inline async body, like the Fighters panel's own reads and for the
    // same reason it gives: `read` opens with `setBusy(true)`, and a state
    // write reached from the effect body itself is what
    // `react-hooks/set-state-in-effect` refuses. The writes belong in the
    // continuation.
    void (async () => {
      await read();
    })();
  }, [read, readable]);

  /*
    The armed command, and the third field.

    "Take this" used to fill the id and the fighter and stop, which left the
    operator staring at a Run button that could not run: `take_duel` is
    caller-priced, and `/api/act` refuses a caller-priced command with no
    ceiling before it signs anything. Reported as "nothing happens" — the
    refusal was landing in the Response pane, in the other column, which is a
    long way from the button that caused it.

    The ceiling starts at the listing's own posted stake. `stakeToCents` carries
    the argument for why converting it is safer than asking for it to be typed,
    and returns null on anything it does not recognise exactly — which prefills
    nothing rather than guessing, leaving the visible blank field it replaced.

    It is a starting value and not a decision: the command pane renders the
    field, the operator can change it, and `pay.ts`'s offer gate still compares
    the arena's 402 against whatever the number ends up being. Nothing here
    settles, and nothing here is the price.
  */
  const arm = (listing: Listing) => {
    const ceiling = stakeToCents(listing.stakeUsdc);
    onArm("take_duel", {
      id: String(listing.duelId),
      characterId: selectedFighter === null ? "" : String(selectedFighter),
      maxCents: ceiling === null ? "" : String(ceiling),
    });
  };

  return (
    <Panel
      drag={drag}
      icon="swords"
      title="Duel pool — as of the last read"
      className="pane-duels"
      actions={
        <button
          type="button"
          className="icon-btn labelled"
          disabled={busy || !readable}
          onClick={() => void read()}
        >
          <Icon name="rotate-cw" size={13} />
          {busy ? "Reading…" : "Re-read"}
        </button>
      }
    >
      <div className="duels-body">
        {!readable ? (
          /* The server's own sentence, verbatim. A refusal explained in words
             this component invented would be a second opinion about a rule it
             does not hold. */
          <p className="pane-body empty small">{cap?.reason ?? "The duel pool is not available."}</p>
        ) : error ? (
          <p className="pane-body empty small">
            <code>{error}</code>
          </p>
        ) : listings === null ? (
          <p className="pane-body empty small">{busy ? "Reading the pool…" : "Nothing read yet."}</p>
        ) : listings.length === 0 ? (
          /* Only reachable when the arena actually returned an empty array —
             `listingsOf` returns null for everything else, which is what keeps
             this sentence a report rather than a guess. */
          <p className="pane-body empty small">No open listings. The arena returned an empty pool.</p>
        ) : (
          <ul className="duel-rows">
            {listings.map((listing) => (
              <li key={listing.duelId} className="duel-row">
                <span className="duel-id num">#{listing.duelId}</span>
                <span className="duel-arena">{listing.arenaName}</span>
                {/* Printed as the arena wrote it. Parchment, not ember: this
                    card reports an amount and the Run button spends one. */}
                <span className="duel-stake num">{listing.stakeUsdc} USDC</span>
                <span className="duel-listed">
                  <Time iso={listing.listedAt} zone={false} />
                </span>
                <button
                  type="button"
                  className="icon-btn duel-take"
                  disabled={disabled || !(takeCap?.enabled ?? true)}
                  title={takeCap?.reason ?? "Fill the command pane with this listing"}
                  onClick={() => arm(listing)}
                >
                  <Icon name="coins" size={13} />
                  Take this
                </button>
              </li>
            ))}
          </ul>
        )}

        {/*
          The same sentence the Fighters panel's arm row prints, and it has to
          be here too. That row is under a fighter's detail and this list is in
          another column — an operator who arrives at "Take this" from the
          market has not read the other one, and "these fill the command pane
          and stop" is exactly the thing they need to have read before pressing
          a button on a card full of stakes.

          Gated on the pool being readable, which is not tidiness: printed on a
          card whose body is "duels are closed", it explains a control that is
          not on the screen — and it does so in the words of a control that
          takes a listing, on a card that has just said there are none to take.
          A caption for an absent button is the sort of thing an operator reads
          as a promise about what will happen when they find it.
        */}
        {readable && (
          <p className="field-hint">
            Open listings, anonymous by design — the pool shows the arena, the stake and when it
            was listed, and nothing about the fighter or the host. &ldquo;Take this&rdquo; fills
            the command pane — the duel, your fighter, and a ceiling started at the listing&rsquo;s
            own posted stake for you to change — and stops. Nothing here settles an amount; the
            Run button does, and it is the only one that can.
          </p>
        )}

        {readAt && (
          <p className="field-hint muted">
            Read at <Time iso={readAt} />. Listings are taken by other agents — this list is a
            photograph, not a feed.
          </p>
        )}
      </div>
    </Panel>
  );
}
