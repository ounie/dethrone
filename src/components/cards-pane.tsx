"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./icon";
import Panel, { type PanelDrag } from "./panel";
import Time from "./time";
import type { Capabilities } from "@/lib/capability";
import { microToUsd, priceLabel } from "@/lib/rail-format";

/**
 * House Cards the house has announced, and the market on each.
 *
 * ## Why this card exists
 *
 * A House Card is the one thing on this arena nobody pays for: the house books
 * a demonstration between two consenting fighters, and it settles no seat, no
 * pot and no purse. Until `GET /api/cards` there was no way for an operator to
 * learn one was coming — `GET /api/rail` publishes pools against a
 * `summonsCardId` and nothing that resolves one, so a market could be read and
 * its two sides could not be named. This card reads the route that carries
 * both, which is also why it does not join anything: the arena hands over the
 * card and its market together, already matched.
 *
 * ## It reads and it arms. It does not spend.
 *
 * "Back A" / "Back B" call `onArm` — `console.tsx`'s `loadCommand` — which
 * selects `take_position` and fills its fields. The command pane still shows
 * every argument, the Run button is still the only control that settles an
 * amount, and a caller-priced command still earns its ceiling check and its
 * confirmation. `test/duels-pane.test.ts`'s rule holds here too: nothing in
 * this file may `act(...)` a paid command.
 *
 * ## The stake it arms with is a FLOOR, not an opinion
 *
 * `take_position` is caller-priced — the amount you pay IS your stake — so
 * there is no quote to prefill. The minimum position is the arena's own number
 * and arrives on the rules; this card fills it as a starting value and the
 * operator types what they mean. A console that suggested a bigger number would
 * be holding an opinion about a market, which is the thing the duel pool's own
 * note refuses at length.
 *
 * ## Prices are printed, never computed
 *
 * `impliedPriceABps` is the arena's basis points and `null` means the price has
 * not FORMED — which is not zero and must not render as a percentage. Pools are
 * micro-USDC strings for the reason every money figure crossing this wire is a
 * string: `JSON.stringify` throws on a bigint rather than rounding one, and a
 * browser must never be handed a float it could re-round.
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

interface Side {
  name: string;
  houseName: string | null;
  /** Resolved by the arena. Never a path composed here: a client that builds an
   *  S3 URL holds a second copy of where those objects live. */
  imageUrl: string | null;
  wins: number;
  fights: number;
}

interface Market {
  id: string;
  state: string;
  poolAMicro: string;
  poolBMicro: string;
  openInterestMicro: string;
  priceABps: number | null;
  priceBBps: number | null;
}

interface Card {
  id: string;
  bellAt: string;
  arenaName: string | null;
  a: Side;
  b: Side;
  market: Market | null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function bps(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * One fighter, or null when the row cannot be rendered honestly.
 *
 * The NAME is the fighter's own and the arena sends it; a card whose fighter has
 * none falls back to the id, which is what the arena's own strip does. Never the
 * owner's name — one wallet can own several faces.
 */
function sideOf(raw: unknown): Side | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const id = o.id;
  if (typeof id !== "number") return null;
  return {
    name: str(o.name) ?? `Fighter #${id}`,
    houseName: str(o.houseName),
    imageUrl: str(o.imageUrl),
    wins: num(o.wins),
    fights: num(o.fights),
  };
}

function marketOf(raw: unknown): Market | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const id = str(o.id);
  const poolA = str(o.poolAMicro);
  const poolB = str(o.poolBMicro);
  if (!id || poolA === null || poolB === null) return null;
  return {
    id,
    state: str(o.state) ?? "unknown",
    poolAMicro: poolA,
    poolBMicro: poolB,
    openInterestMicro: str(o.openInterestMicro) ?? "0",
    priceABps: bps(o.impliedPriceABps),
    priceBBps: bps(o.impliedPriceBBps),
  };
}

/**
 * The cards out of an envelope, or null when the read did not produce any.
 *
 * Null and `[]` are deliberately different answers, and the card renders them
 * differently: an empty list and an unreachable arena look identical once a
 * failed read is flattened, and "nothing is booked" is a claim this pane makes
 * only when the arena actually said so.
 */
function cardsOf(data: Record<string, unknown>): Card[] | null {
  const body = data.body as { cards?: unknown } | undefined;
  if (!body || !Array.isArray(body.cards)) return null;

  const out: Card[] = [];
  for (const raw of body.cards) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const id = str(row.id);
    const bellAt = str(row.bellAt);
    const a = sideOf(row.a);
    const b = sideOf(row.b);
    if (!id || !bellAt || !a || !b) continue;
    out.push({
      id,
      bellAt,
      arenaName: str(row.arenaName) ?? str(row.arenaSlug),
      a,
      b,
      market: marketOf(row.market),
    });
  }
  return out;
}

/**
 * The arena's own code, or the console's. Never a sentence invented here.
 *
 * ⚠️ The STATUS is consulted before the fallback, and that is the whole reason
 * this differs from the duel pool's copy. `/api/cards` is newer than some
 * arenas: point this console at one that predates the route and it answers a
 * bare 404, whose body carries no error envelope to read a code from — so the
 * generic fallback rendered as *"the cards could not be read"*, which describes
 * a fault and not the truth, which is that this arena does not have the route.
 * Reported exactly that way, against a deploy where it was simply not shipped
 * yet.
 */
function codeOf(data: Record<string, unknown>, fallback: string): string {
  const body = data.body as { error?: { code?: string } } | undefined;
  const err = data.error as { code?: string } | undefined;
  const code = body?.error?.code ?? err?.code;
  if (code) return code;
  const status = data.status;
  if (typeof status === "number" && status !== 200) return `arena_answered_${status}`;
  return fallback;
}

/**
 * A fighter's plate, or a glyph where there is none.
 *
 * The portrait is the point of a card — a House Card is a promise about two
 * SPECIFIC fighters, and this pane described them in words alone for a release.
 * A plain `<img>` against the arena's public content-addressed storage, exactly
 * as the match card's own portraits do it, and never a composed path.
 *
 * An empty plate reads as a broken image beside a filled one, so a fighter with
 * no render gets the lane's glyph rather than a blank rectangle.
 */
function Face({ url }: { url: string | null }) {
  if (!url) {
    return (
      <span className="card-face empty" aria-hidden="true">
        <Icon name="swords" size={13} />
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="card-face" src={url} alt="" loading="lazy" />;
}

/** `0W – 2L`, or the honest blank. A fighter with no verdicts has no record. */
function record(s: Side): string {
  return s.fights === 0 ? "no record" : `${s.wins}W – ${s.fights - s.wins}L`;
}

export default function CardsPane({
  capabilities,
  operator,
  disabled,
  minPositionCents,
  baseUrl,
  onArm,
  drag,
}: {
  capabilities: Capabilities;
  /**
   * The address currently signing, or null on a read-only deploy.
   *
   * Not rendered. It is on the props because the read is the same for everyone
   * and the position armed off it is not — the same argument the duel pool
   * makes — so a wallet switch drops the read with the arming.
   */
  operator: string | null;
  disabled: boolean;
  /**
   * The arena's own minimum position, in cents, or null when it published none.
   * A starting value for the armed stake and never a suggestion: this console
   * holds no opinion about how much anybody should back a fighter.
   */
  minPositionCents: number | null;
  /**
   * The arena this console is pointed at, for the card's own page. Handed down
   * rather than composed: the match card takes it for its fighter and House
   * links, and a second copy would be the console deciding where the arena is.
   */
  baseUrl: string;
  onArm: (commandId: string, args: Record<string, string>) => void;
  drag?: PanelDrag;
}) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [readAt, setReadAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [signedAs, setSignedAs] = useState(operator);
  if (operator !== signedAs) {
    setSignedAs(operator);
    setCards(null);
    setReadAt(null);
    setError(null);
  }

  const cap = capabilities.cards;
  const backCap = capabilities.take_position;
  const readable = cap?.enabled ?? true;

  const read = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // No arguments: the route's own default is announced cards whose bell is
      // still ahead, soonest first, which is exactly "what is coming". The
      // catalogue carries `status=all` for an operator who wants the history.
      const data = await act("cards", {});
      const rows = cardsOf(data);
      if (rows === null) {
        setError(codeOf(data, "the_cards_could_not_be_read"));
        setCards(null);
      } else {
        setCards(rows);
      }
      setReadAt(new Date().toISOString());
    } catch {
      setError("the_console_could_not_be_reached");
      setCards(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!readable) return;
    // Inline async body: `read` opens with `setBusy(true)`, and a state write
    // reached from an effect body is what `react-hooks/set-state-in-effect`
    // refuses. Same shape as the duel pool's own mount read.
    void (async () => {
      await read();
    })();
  }, [read, readable]);

  /*
    Arming a position.

    Three fields and a ceiling: the market, the side, and the stake — which IS
    the price on this route, so `maxCents` is filled with the same number rather
    than with a quote. `/api/act` refuses a caller-priced command with no
    ceiling before it signs anything, which is what made the duel pool's
    "nothing happens" report, and this card starts with a number for the same
    reason it did.
  */
  const arm = (card: Card, outcome: "a" | "b") => {
    if (!card.market) return;
    const cents = minPositionCents === null ? "" : String(minPositionCents);
    onArm("take_position", {
      id: card.market.id,
      outcome,
      amountCents: cents,
      maxCents: cents,
    });
  };

  return (
    <Panel
      drag={drag}
      icon="hourglass"
      title="House Cards — as of the last read"
      className="pane-cards"
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
      <div className="cards-body">
        {!readable ? (
          <p className="pane-body empty small">{cap?.reason ?? "House Cards are not available."}</p>
        ) : error ? (
          <p className="pane-body empty small">
            <code>{error}</code>
          </p>
        ) : cards === null ? (
          <p className="pane-body empty small">{busy ? "Reading the cards…" : "Nothing read yet."}</p>
        ) : cards.length === 0 ? (
          <p className="pane-body empty small">
            No cards announced. The arena returned an empty list.
          </p>
        ) : (
          <ul className="card-rows">
            {cards.map((c) => (
              <li key={c.id} className="card-row">
                {/*
                  The fixture is a LINK to the card's own page on the arena.

                  A row that looks like a row of a list has to do something when
                  it is pressed; this one rendered as inert text and was
                  reported as exactly that. It opens the arena rather than
                  rebuilding the card here, which is the same rule the match
                  card follows for fighters, Houses and arenas: the page one
                  click away has both portraits at poster size, the countdown,
                  the whole market with its position command, and the verdict
                  once the bell has rung.
                */}
                <a
                  className="card-open"
                  href={`${baseUrl}/cards/${c.id}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <div className="card-fixture">
                    <span className="card-side">
                      <Face url={c.a.imageUrl} />
                      <span className="card-names">
                        <span className="card-fighter ellipsis">{c.a.name}</span>
                        <span className="card-meta ellipsis">
                          {c.a.houseName ?? "Unhoused"} ·{" "}
                          <span className="num">{record(c.a)}</span>
                        </span>
                      </span>
                    </span>
                    <span className="card-vs eyebrow">vs</span>
                    <span className="card-side right">
                      <span className="card-names">
                        <span className="card-fighter ellipsis">{c.b.name}</span>
                        <span className="card-meta ellipsis">
                          {c.b.houseName ?? "Unhoused"} ·{" "}
                          <span className="num">{record(c.b)}</span>
                        </span>
                      </span>
                      <Face url={c.b.imageUrl} />
                    </span>
                  </div>

                  <div className="card-when">
                    <span className="card-arena ellipsis">{c.arenaName ?? "—"}</span>
                    <span className="card-when-right">
                      {/* The bell as the arena sent it, in the reader's own
                          zone. `format.ts` refuses relative time: a stamp that
                          keeps moving while the data behind it does not makes a
                          stale reading look fresh. */}
                      <Time iso={c.bellAt} />
                      <span className="card-open-hint">Card ↗</span>
                    </span>
                  </div>
                </a>

                {c.market && (
                  <div className="card-market">
                    <span className="card-pool">
                      <span className="num">${microToUsd(c.market.poolAMicro) ?? "—"}</span>
                      <span className="card-price">{priceLabel(c.market.priceABps)}</span>
                    </span>
                    <span className="card-oi eyebrow">
                      open interest <span className="num">${microToUsd(c.market.openInterestMicro) ?? "—"}</span>
                    </span>
                    <span className="card-pool right">
                      <span className="card-price">{priceLabel(c.market.priceBBps)}</span>
                      <span className="num">${microToUsd(c.market.poolBMicro) ?? "—"}</span>
                    </span>
                  </div>
                )}

                {c.market && c.market.state === "open" && (
                  <div className="card-actions">
                    {/* Two buttons and not a picker: the side IS the choice, and
                        a select plus a submit is one more control between an
                        operator and a decision they have already made. Both arm
                        the command pane; neither spends. */}
                    <button
                      type="button"
                      className="icon-btn"
                      disabled={disabled || !(backCap?.enabled ?? true)}
                      title={backCap?.reason ?? "Fill the command pane with this side"}
                      onClick={() => arm(c, "a")}
                    >
                      <Icon name="coins" size={13} />
                      Back {c.a.name}
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      disabled={disabled || !(backCap?.enabled ?? true)}
                      title={backCap?.reason ?? "Fill the command pane with this side"}
                      onClick={() => arm(c, "b")}
                    >
                      <Icon name="coins" size={13} />
                      Back {c.b.name}
                    </button>
                  </div>
                )}

                {c.market && c.market.state !== "open" && (
                  <p className="card-halted small">
                    Market {c.market.state}. Nothing can be taken on it.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {readAt && (
          <p className="field-hint">
            read <Time iso={readAt} />
          </p>
        )}
      </div>
    </Panel>
  );
}
