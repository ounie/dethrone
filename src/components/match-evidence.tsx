"use client";

import { Fragment, useState } from "react";
import Icon from "./icon";
import {
  HP_START,
  lifebarOf,
  throwTotal,
  type LifebarCoin,
  type LifebarRole,
  type LifebarView,
} from "@/lib/lifebar";
import type { Exchange, MatchView } from "@/lib/match-view";

/**
 * The evidence panel — the arena's verdict card, ported: the life bars and
 * the coin log as a record table, rendered under the playback.
 *
 * ## What is computed here, and under whose licence
 *
 * Every winner on this surface is the published `marks`; the match winner is
 * the published verdict; every roll, modifier, advantage state and tie path
 * is the stored record as it arrived. The ONE piece of arithmetic — the bars
 * and the margin/damage columns — is `lib/lifebar.ts`, the arena's own
 * display model ported semantics-for-semantics and pinned to its goldens.
 * The footer says on the surface what the module says in its header:
 * informational — marks decide.
 *
 * ## The colours are the arena's identity law
 *
 * Throne gold, challenger STEEL, and red reserved exclusively for damage —
 * red-as-identity collides with red-as-damage in a table like this one. The
 * crown medallion is the seat's face everywhere a coin winner shows.
 */

const MARK_MEDALLION: Record<LifebarRole, string> = {
  THRONE: "https://dethrone.bot/brand/medallion-crown.webp",
  CHALLENGER: "https://dethrone.bot/brand/medallion-challenger.webp",
};

const ROLE_LABEL: Record<LifebarRole, string> = { THRONE: "throne", CHALLENGER: "challenger" };

const isRole = (v: unknown): v is LifebarRole => v === "CHALLENGER" || v === "THRONE";

/** A coin's throw written the way the arena's log writes it: `die+judges(+variety)`. */
function throwOf(c: LifebarCoin, r: LifebarRole): string {
  return `${c.roll[r]}+${c.mod[r]}${c.variety[r] > 0 ? `+${c.variety[r]}` : ""}`;
}

/** Whatever the tie ladder or the naturals add to a coin — record words only. */
function coinNotes(e: Exchange, disputed: boolean): string[] {
  const c = e.contest;
  if (!c) return [];
  const w = isRole(e.winnerRole) ? e.winnerRole : null;
  const l: LifebarRole | null = w === null ? null : w === "CHALLENGER" ? "THRONE" : "CHALLENGER";
  const notes: string[] = [];
  if (c.tiePath === "mod") notes.push("tie — held on the higher judge bonus");
  if (c.tiePath === "seeded" && w && l) {
    notes.push(`tie — seeded draw ${c.tieBreakRolls[w].at(-1)}–${c.tieBreakRolls[l].at(-1)}`);
  }
  if (c.flourish.CHALLENGER || c.flourish.THRONE) notes.push("nat 20");
  if (c.stumble.CHALLENGER || c.stumble.THRONE) notes.push("nat 1");
  for (const r of ["THRONE", "CHALLENGER"] as const) {
    if (c.variety[r] === 0) notes.push(`repeat — ${ROLE_LABEL[r]} variety forfeited`);
  }
  if (disputed) notes.push("stored totals dispute the mark — chip only");
  return notes;
}

function AdvChip({ c, r }: { c: LifebarCoin & { advantage: Record<LifebarRole, string> }; r: LifebarRole }) {
  const state = c.advantage[r];
  return (
    <span
      className="evi-chip num"
      title={state === "none" ? "wash — no advantage either way" : undefined}
    >
      {state === "advantage" ? "adv" : state === "disadvantage" ? "dis" : "—"}
    </span>
  );
}

/**
 * The bars at coin `n` — the record, wound forward rather than recomputed.
 *
 * `lifebarOf` publishes the fall and the wear PER COIN, so the state after any
 * number of them is a prefix sum and nothing else. Nothing here decides who is
 * losing: which side takes the fall was settled by the marks before this ran.
 *
 * At `n = every coin` this is exactly `bar.final` — the loser's fall sums to
 * 100 by construction (the remainder lands on their last lost coin) and the
 * winner's wear sums to `100 − final[winner]`. So the animation ends on the
 * published figure rather than near it, which is the property that makes it
 * safe to drive the same bars from a playback.
 */
function hpAfter(bar: LifebarView, loser: LifebarRole, n: number): Record<LifebarRole, number> {
  const sum = (xs: number[]) => xs.slice(0, n).reduce((a, b) => a + b, 0);
  const winner: LifebarRole = loser === "THRONE" ? "CHALLENGER" : "THRONE";
  const out = { CHALLENGER: HP_START, THRONE: HP_START };
  out[loser] = Math.round((HP_START - sum(bar.damage)) * 10) / 10;
  out[winner] = Math.round((HP_START - sum(bar.wear)) * 10) / 10;
  return out;
}

function LifeBars({ hp }: { hp: Record<LifebarRole, number> }) {
  return (
    <div className="evi-bars">
      <span className="num evi-hp" data-role="THRONE">
        {Math.round(hp.THRONE)}
        <span className="evi-hp-unit">hp</span>
      </span>
      <div className="evi-bar" data-role="THRONE">
        <div style={{ width: `${Math.max(0, Math.min(100, hp.THRONE))}%` }} />
      </div>
      <span className="num evi-hp-note">
        HP
        <br />
        display only
        <br />
        decides nothing
      </span>
      <div className="evi-bar" data-role="CHALLENGER">
        <div style={{ width: `${Math.max(0, Math.min(100, hp.CHALLENGER))}%` }} />
      </div>
      <span className="num evi-hp" data-role="CHALLENGER">
        {Math.round(hp.CHALLENGER)}
        <span className="evi-hp-unit">hp</span>
      </span>
    </div>
  );
}

export default function MatchEvidence({
  match,
  revealed,
}: {
  match: MatchView;
  /**
   * How many coins the playback above has landed.
   *
   * The panel used to render only the finished record, which made "Run the
   * verdict" animate the board and leave the bars and the table sitting at
   * their end state — the fight played out above a scoreboard that already
   * knew the answer. The bars now drain as each coin lands and each row
   * ARRIVES when its coin does.
   *
   * Omitted means the whole record, which is the state a card at rest is in and
   * the state the panel renders with no JavaScript at all: the record is public
   * the moment the verdict is, and this replay only relights it.
   *
   * A COUNT rather than a set, because coins land in order — a set would admit
   * a fourth coin revealed before a second, which the timeline cannot produce.
   */
  revealed?: number;
}) {
  /* The rows are in the DOM either way; this only toggles their visibility. */
  const [openEx, setOpenEx] = useState<ReadonlySet<number>>(new Set());

  const verdict = match.verdict;
  const exchanges = match.exchanges;
  const contests = exchanges.map((e) => e.contest);
  if (!verdict || !contests.some(Boolean)) return null;

  const marks = verdict.marks.filter(isRole);
  const bar =
    marks.length === exchanges.length &&
    verdict.tallyChallenger !== null &&
    verdict.tallyThrone !== null
      ? lifebarOf(contests, marks, {
          CHALLENGER: verdict.tallyChallenger,
          THRONE: verdict.tallyThrone,
        })
      : null;
  const hp = bar !== null;
  /* Which side the fall lands on, read off the ported view's own output — the
     loser's bar is the one at zero. Labels only; never a verdict. */
  const matchWinner: LifebarRole = bar
    ? bar.final.THRONE > 0
      ? "THRONE"
      : "CHALLENGER"
    : "THRONE";
  const matchLoser: LifebarRole = matchWinner === "THRONE" ? "CHALLENGER" : "THRONE";

  /* Clamped, so a frame from a longer or shorter timeline can never make the
     panel show more coins than the record has. */
  const landed = Math.max(0, Math.min(exchanges.length, revealed ?? exchanges.length));
  /*
    The rows the table actually holds: exactly the coins the playback has
    landed.

    They used to all render and DIM ahead of the stage, on the argument that the
    record is public the moment the verdict is and a vanished row would be this
    panel concealing evidence. Sound about the record, wrong about the replay —
    a dimmed row is still a legible row, so the whole table sat there spoiling
    coins the stage had not reached, on the one surface whose entire job is
    playing them in order. Nothing is concealed by this: a card at rest passes
    no `revealed` at all and holds the whole log, including with no JavaScript,
    and the table is whole again the instant the run ends.
  */
  const rows = revealed === undefined ? exchanges : exchanges.slice(0, landed);
  const hpNow = bar ? hpAfter(bar, matchLoser, landed) : null;

  const toggleEx = (k: number) =>
    setOpenEx((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="evi">
      {hpNow ? <LifeBars hp={hpNow} /> : null}

      <div className="evi-table-wrap">
        <table className="evi-table" data-hp={hp ? "true" : undefined}>
          <thead>
            <tr>
              <th scope="col">Coin</th>
              <th scope="col">
                Mark
                <span className="evi-th-sub">who took it</span>
              </th>
              <th scope="col" data-role="THRONE">
                Throne total
                <span className="evi-th-sub">adv / dis</span>
              </th>
              <th scope="col" data-role="CHALLENGER">
                Challenger total
                <span className="evi-th-sub">adv / dis</span>
              </th>
              {hp ? (
                <>
                  <th scope="col">
                    Margin
                    <span className="evi-th-sub">points</span>
                  </th>
                  <th scope="col">
                    Spread
                    <span className="evi-th-sub">max−min</span>
                  </th>
                  <th scope="col">
                    Damage
                    <span className="evi-th-sub">hp</span>
                  </th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((e, k) => {
              const c = e.contest;
              const w = isRole(e.winnerRole) ? e.winnerRole : null;
              const clash = c ? c.tiePath !== "none" : false;
              const margin = c
                ? Math.abs(throwTotal(c, "THRONE") - throwTotal(c, "CHALLENGER"))
                : null;
              const notes = coinNotes(e, bar?.disputed[k] === true);
              const throwCell = (r: LifebarRole) => (
                <td className="num evi-throw" data-role={r} data-lost={w && r !== w ? "true" : undefined}>
                  {c ? (
                    <>
                      {throwOf(c, r)} = {throwTotal(c, r)} <AdvChip c={c} r={r} />
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              );
              return (
                <Fragment key={k}>
                  <tr
                    className="evi-row"
                    onClick={() => toggleEx(k)}
                    aria-expanded={openEx.has(k)}
                  >
                    <td className="evi-coin display">{k + 1}</td>
                    <td>
                      {/* The mark — the winner's struck disc, read from the
                          published winnerRole alone. A gilt ring is a clash: a
                          tie held by the path the notes name. */}
                      {w ? (
                        <span className="evi-mark" data-clash={clash ? "true" : undefined}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={MARK_MEDALLION[w]}
                            alt={w === "THRONE" ? "Coin to the throne" : "Coin to the challenger"}
                            width={40}
                            height={40}
                          />
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    {throwCell("THRONE")}
                    {throwCell("CHALLENGER")}
                    {hp ? (
                      <>
                        <td className="num">
                          {margin === null ? "—" : clash && margin === 0 ? "0 · clash" : margin}
                        </td>
                        <td className="num evi-spread">{bar!.spreads[k]}</td>
                        {/* Damage is RED, and red is only ever damage — the
                            identity colours stay gold and steel. The loser's
                            fall leads; the winner's wear rides under it. */}
                        <td className="num evi-dmg">
                          {bar!.damage[k] > 0 ? (
                            <span className="evi-dmg-line">
                              −{bar!.damage[k].toFixed(1)} hp
                              <span className="evi-dmg-to">→ {ROLE_LABEL[matchLoser]}</span>
                            </span>
                          ) : null}
                          {bar!.wear[k] > 0 ? (
                            <span className="evi-dmg-line evi-dmg-wear">
                              −{bar!.wear[k].toFixed(1)} hp
                              <span className="evi-dmg-to">→ {ROLE_LABEL[matchWinner]}</span>
                            </span>
                          ) : null}
                        </td>
                      </>
                    ) : null}
                  </tr>
                  {openEx.has(k) ? (
                    <tr className="evi-ex">
                      <td colSpan={hp ? 7 : 4}>
                        <div className="evi-ex-body">
                          <span>
                            <span className="num evi-ex-side" data-role="THRONE">
                              Throne{e.throne ? ` · ${e.throne.type}` : ""}
                            </span>
                            {e.throne?.text ?? "an action"}
                          </span>
                          <span>
                            <span className="num evi-ex-side" data-role="CHALLENGER">
                              Challenger{e.challenger ? ` · ${e.challenger.type}` : ""}
                            </span>
                            {e.challenger?.text ?? "an action"}
                          </span>
                          {notes.length ? <span className="num evi-ex-notes">{notes.join(" · ")}</span> : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
          {/* The ledger's footer: column sums at the bottom of the columns they
              total. The aggregate is a display figure and the label carries its
              caveat; the damage total is the loser's whole drain.

              Gated on the run having FINISHED, the arena's own rule: these are
              totals over every coin, and printing them beside a table that has
              only lit two of five states a sum of numbers the reader cannot yet
              see. It returns the moment the last coin lands. */}
          {bar && landed >= exchanges.length ? (
            <tfoot>
              <tr>
                <td colSpan={2} className="evi-foot-label">
                  <span className="num">Aggregate</span>
                  <span className="num evi-th-sub">informational — marks decide</span>
                </td>
                <td className="num evi-foot-total" data-role="THRONE">
                  {bar.aggregate.THRONE}
                </td>
                <td className="num evi-foot-total" data-role="CHALLENGER">
                  {bar.aggregate.CHALLENGER}
                </td>
                <td className="num">{Math.abs(bar.aggregate.THRONE - bar.aggregate.CHALLENGER)}</td>
                <td />
                <td className="num evi-dmg">
                  {(["THRONE", "CHALLENGER"] as const)
                    .filter((r) => bar.final[r] < 100)
                    .map((r) => (
                      <span key={r} className="evi-dmg-line">
                        −{(Math.round((100 - bar.final[r]) * 10) / 10).toFixed(1)} hp
                        <span className="evi-dmg-to">→ {ROLE_LABEL[r]}</span>
                      </span>
                    ))}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      <p className="evi-key num">
        <Icon name="chevron-down" size={10} /> click a coin to read its exchange — clash, repeat
        and dispute notes live there too
      </p>
      {verdict.rubricVersion ? (
        <p className="evi-law num">
          every number is the stored record · marks decide · scored under {verdict.rubricVersion}
        </p>
      ) : null}
    </div>
  );
}
