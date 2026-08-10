"use client";

import Icon from "./icon";
import Panel from "./panel";
import Time from "./time";
import type { MyDuel, MyMatch, Standing } from "@/lib/standing";
import { stamp } from "@/lib/format";
import { shortAddress } from "@/lib/format";

/**
 * Where you stand: the throne, your record, your duels, your matches.
 *
 * ## Everything on this card was read, and nothing was worked out
 *
 * The console's first rule is that a UI which branches on game state is a
 * second implementation of the game, and a "your standing" card is exactly
 * where that starts. So there is no eligibility here, no "you could challenge
 * now", no countdown to anything, no computed rank and no derived record. Four
 * server reads answer four questions and this renders their answers —
 * `lib/standing.ts` carries the argument at length.
 *
 * The one comparison anywhere is *is the champion's address mine*, done on the
 * server against two strings it already held. Noticing that two addresses are
 * equal is not a rule.
 *
 * ## An unreachable read is not an empty one
 *
 * Every section can say "could not be read", because a wallet with no duels and
 * a duels feature that is switched off look identical once a failed read is
 * rendered as `[]`. "You have none" is a claim, and this card only makes it
 * when the arena actually said so.
 *
 * ## No money colour
 *
 * The jackpot and a duel's stake are amounts, and they are rendered in the same
 * parchment as everything else. `globals.css`'s first paragraph spends ember on
 * one thing — the button that settles an amount now — and a standing card
 * reports rather than spends.
 */

function Line({
  icon,
  label,
  value,
  tone,
  node,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  value: string | null;
  tone?: "ok" | "muted";
  /** Rendered instead of `value` when the value is not plain text. */
  node?: React.ReactNode;
}) {
  return (
    <div className="standing-line">
      <span className="standing-label">
        <Icon name={icon} size={13} />
        {label}
      </span>
      <span
        className="standing-value num"
        data-tone={tone}
        data-empty={node === undefined && value === null}
      >
        {node ?? value ?? "—"}
      </span>
    </div>
  );
}

/** The arena's own vocabulary, spaced. Never relabelled — DEFENDED is DEFENDED. */
function outcomeOf(m: MyMatch): string {
  if (m.outcome) return m.outcome.replace(/_/g, " ");
  return m.status ?? "—";
}

/**
 * Did this wallet win?
 *
 * Not a rule and not a scoreboard: it reads the arena's own `outcome` against
 * the side this wallet was on, both of which came from the same row. It tints a
 * badge and decides nothing.
 */
function wonIt(m: MyMatch): boolean | null {
  if (m.outcome === "SEAT_TAKEN") return m.side === "challenger";
  if (m.outcome === "DEFENDED") return m.side === "champion";
  return null;
}

function DuelRow({ duel }: { duel: MyDuel }) {
  return (
    <li className="standing-row">
      <span className="standing-row-main num">
        #{duel.id}
        {duel.arenaSlug && <span className="standing-dim"> · {duel.arenaSlug}</span>}
        {duel.viewer && <span className="standing-dim"> · as {duel.viewer}</span>}
      </span>
      <span className="standing-row-side">
        {duel.stakeUsdc && <span className="num standing-dim">{duel.stakeUsdc} USDC</span>}
        <span className="standing-state" data-live={duel.live}>
          {duel.state}
        </span>
      </span>
    </li>
  );
}

export default function StandingPane({ standing }: { standing: Standing }) {
  const live = standing.duels.filter((d) => d.live);
  const settled = standing.duels.filter((d) => !d.live);
  const s = standing;

  return (
    <Panel icon="shield-check" title="Your standing" className="pane-standing">
      <div className="standing-body">
        {!s.wallet ? (
          /* The read-only branch. Same shape as the masthead's notice: no key,
             nothing to have a standing about, and no invented empty state. */
          <p className="muted">
            Read-only. This deploy holds no key, so there is no wallet to have a standing.
          </p>
        ) : (
          <>
            {/* ── The throne ───────────────────────────────────────────────── */}
            <section className="standing-block">
              <h3 className="eyebrow">The throne</h3>
              {s.holdsThrone ? (
                <>
                  <p className="standing-headline">
                    <Icon name="crown" size={15} />
                    You hold the seat
                  </p>
                  <Line
                    icon="hourglass"
                    label="Took it at"
                    value={null}
                    node={s.tookSeatAt ? <Time iso={s.tookSeatAt} /> : undefined}
                  />
                  <Line
                    icon="shield-check"
                    label="Defenses this tenure"
                    value={s.tenureDefenses === null ? null : String(s.tenureDefenses)}
                  />
                  <Line icon="coins" label="Jackpot riding on it" value={s.jackpotUsdc} />
                </>
              ) : (
                <>
                  <p className="standing-headline muted">
                    <Icon name="landmark" size={15} />
                    {s.championWallet ? "Somebody else holds the seat" : "The seat is vacant"}
                  </p>
                  {s.championWallet && (
                    <Line
                      icon="crown"
                      label="Champion"
                      value={shortAddress(s.championWallet)}
                    />
                  )}
                  <Line icon="coins" label="Jackpot" value={s.jackpotUsdc} />
                </>
              )}
            </section>

            {/* ── The record ───────────────────────────────────────────────── */}
            <section className="standing-block">
              <h3 className="eyebrow">Your record</h3>
              {s.unreachable.record ? (
                <p className="muted">The record could not be read.</p>
              ) : !s.record ? (
                <p className="muted">
                  No record yet. It appears once this wallet has been in a match.
                </p>
              ) : (
                <>
                  <Line
                    icon="circle"
                    label="Elo"
                    value={s.record.elo === null ? null : String(s.record.elo)}
                  />
                  {/* The board's own dense rank string, never a position this
                      component counted for itself. */}
                  <Line
                    icon="crown"
                    label="Rank"
                    value={s.record.rank === null ? null : `#${s.record.rank}`}
                  />
                  <Line
                    icon="swords"
                    label="Throne wins · losses"
                    value={
                      s.record.wins === null && s.record.losses === null
                        ? null
                        : `${s.record.wins ?? 0} · ${s.record.losses ?? 0}`
                    }
                  />
                  <Line
                    icon="shield-check"
                    label="Lifetime defenses"
                    value={s.record.defenses === null ? null : String(s.record.defenses)}
                  />
                  <Line
                    icon="swords"
                    label="Duel wins · losses"
                    value={
                      s.record.duelWins === null && s.record.duelLosses === null
                        ? null
                        : `${s.record.duelWins ?? 0} · ${s.record.duelLosses ?? 0}`
                    }
                  />
                  {/* An amount, in parchment like everything else here. Ember
                      belongs to the one button that settles; this reports. */}
                  <Line icon="coins" label="Lifetime earnings" value={s.record.earningsUsdc} />
                  {s.record.titles.length > 0 && (
                    <ul className="standing-titles">
                      {s.record.titles.map((t) => (
                        // The arena's display string and its own English
                        // predicate, both verbatim. A title this console
                        // paraphrased would be a title it had an opinion about.
                        <li key={t.slug} title={t.predicate ?? undefined}>
                          <Icon name="crown" size={12} />
                          {t.display}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>

            {/* ── The duels ────────────────────────────────────────────────── */}
            <section className="standing-block">
              <h3 className="eyebrow">Your duels</h3>
              {s.unreachable.duels ? (
                <p className="muted">
                  Duels could not be read — the feature may be closed on this deploy.
                </p>
              ) : s.duels.length === 0 ? (
                <p className="muted">You are in no duels.</p>
              ) : (
                <>
                  {live.length > 0 && (
                    <ul className="standing-list">
                      {live.map((d) => (
                        <DuelRow key={d.id} duel={d} />
                      ))}
                    </ul>
                  )}
                  {settled.length > 0 && (
                    <details className="standing-more">
                      <summary>{settled.length} settled</summary>
                      <ul className="standing-list">
                        {settled.map((d) => (
                          <DuelRow key={d.id} duel={d} />
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </section>

            {/* ── The matches ──────────────────────────────────────────────── */}
            <section className="standing-block">
              <h3 className="eyebrow">Your throne matches</h3>
              {s.unreachable.matches ? (
                <p className="muted">The match history could not be read.</p>
              ) : s.matches.length === 0 ? (
                <p className="muted">You have been in no throne matches.</p>
              ) : (
                <ul className="standing-list">
                  {s.matches.map((m) => {
                    const won = wonIt(m);
                    return (
                      /*
                        Two lines, because one could not hold it.

                        A match id, a side, an opponent, a time and an outcome
                        do not fit across a column this narrow, and the single
                        row ellipsised the OPPONENT away — the one field an
                        operator is actually scanning for. The id and the
                        verdict stay on the top line; everything about who and
                        when goes underneath.
                      */
                      <li className="standing-match" key={m.id}>
                        <div className="standing-row">
                          <span className="standing-row-main num">{m.id}</span>
                          <span className="standing-state" data-won={won === null ? undefined : won}>
                            {outcomeOf(m)}
                          </span>
                        </div>
                        <div className="standing-match-meta standing-dim num">
                          as {m.side}
                          {m.opponent && <> · vs {shortAddress(m.opponent)}</>}
                          {m.endedAt && <> · <Time iso={m.endedAt} zone={false} /></>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </Panel>
  );
}
