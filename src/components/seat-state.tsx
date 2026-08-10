"use client";

import Image from "next/image";
import Icon, { type IconName } from "./icon";
import Panel from "./panel";
import Time from "./time";
import { shortAddress } from "@/lib/format";

/**
 * The seat, as of the last read.
 *
 * ## What this panel is careful not to become
 *
 * It renders fields the arena returned, labelled, and nothing else. In
 * particular there is **no ticking countdown**: a clock this console ran would
 * be a second implementation of the vesting rule, and on the day the two
 * disagree the one on this screen is the wrong one. The heading says *as of the
 * last read*, every value is timestamped by the arena, and the footer says
 * plainly that the data may be stale and how to refresh it.
 *
 * That honesty is the feature. A number that keeps moving looks live whether or
 * not it still is; a number that visibly does not move tells the operator
 * exactly how much it is worth.
 */

export interface SeatSnapshot {
  fetchedAtIso: string;
  reachable: boolean;
  /** The champion's wallet, as the arena reports it. Null when the seat is vacant. */
  champion: string | null;
  /** Whether that champion is this console's operator. Decided on the server. */
  isMine: boolean;
  /**
   * The FIGHTER on the seat, which is not the same thing as the agent holding
   * it. An agent is a wallet; a character has a derived name and a page.
   */
  reigningCharacter: { id: number; name: string } | null;
  tookSeatAt: string | null;
  tenureDefenses: number | null;
  jackpotUsdc: string | null;
  liveMatchId: string | null;
  network: string | null;
}

function Row({
  icon,
  label,
  value,
  mono = true,
  suffix,
  node,
}: {
  icon: IconName;
  label: string;
  value: string | null;
  mono?: boolean;
  /** A short badge after the value. Never a number, never a verdict. */
  suffix?: string;
  /** Rendered instead of `value` when the value is not plain text. */
  node?: React.ReactNode;
}) {
  return (
    <div className="seat-row">
      <span className="seat-label">
        <Icon name={icon} size={13} />
        {label}
      </span>
      <span
        className={mono ? "seat-value num" : "seat-value"}
        data-empty={node === undefined && value === null}
      >
        {node ?? value ?? "—"}
        {suffix && <span className="seat-mine">{suffix}</span>}
      </span>
    </div>
  );
}

export default function SeatState({
  seat,
  baseUrl,
}: {
  seat: SeatSnapshot;
  /** The arena this console points at. Where a fighter's own page lives. */
  baseUrl: string;
}) {
  return (
    <Panel
      icon="landmark"
      title="Seat — as of the last read"
      tone="gilt"
      className="pane-seat"
      actions={
        <button type="button" className="icon-btn labelled" onClick={() => location.reload()}>
          <Icon name="rotate-cw" size={13} />
          Refresh
        </button>
      }
    >
      <div className="seat-body">
        <div className="seat-rows">
          {/*
            "you" is the answer to the question this row is actually asked.

            An operator reading their own address back does the comparison in
            their head, character by character, against the one in the masthead
            — and with several wallets configured they can be wrong about which
            one they are. The server did the comparison; this renders it.
          */}
          <Row
            icon="crown"
            label="Champion"
            value={seat.champion ? shortAddress(seat.champion) : null}
            suffix={seat.isMine ? "you" : undefined}
          />
          {/*
            The FIGHTER, under the agent that owns it.

            "Champion" is a wallet; the thing that actually fought is a
            character with a derived name, and the seat card could not name it
            because `/api/seat` did not publish one. It does now, and this links
            out to the arena's own page for it rather than restating anything —
            a fighter's traits, genome, record and portrait all live there, and
            a second rendering here would be a second answer.

            A new tab, and `noreferrer noopener`, exactly as the wallet's
            explorer link beside it.
          */}
          {seat.reigningCharacter && (
            <Row
              icon="swords"
              label="Reigning fighter"
              value={null}
              node={
                <a
                  className="seat-fighter"
                  href={`${baseUrl}/character/${seat.reigningCharacter.id}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={`Open character ${seat.reigningCharacter.id} on the arena`}
                >
                  {seat.reigningCharacter.name}
                  <Icon name="external-link" size={11} />
                </a>
              }
            />
          )}
          <Row
            icon="hourglass"
            label="Took seat at"
            value={null}
            node={seat.tookSeatAt ? <Time iso={seat.tookSeatAt} /> : undefined}
          />
          <Row
            icon="shield-check"
            label="Tenure defenses"
            value={seat.tenureDefenses === null ? null : String(seat.tenureDefenses)}
          />
          <Row icon="coins" label="Jackpot (USDC)" value={seat.jackpotUsdc} />
          <Row icon="swords" label="Live match" value={seat.liveMatchId} />
          <Row icon="compass" label="Network" value={seat.network} mono={false} />
          <Row icon="terminal" label="Read at" value={null} node={<Time iso={seat.fetchedAtIso} />} />
        </div>

        {/* Ceremony, and the one place the crest appears. Decorative — every
            claim on this panel is made by the text beside it. */}
        <Image
          className="seat-crest"
          src="/brand/crest-crown-shield.webp"
          alt=""
          width={383}
          height={512}
        />
      </div>

      <p className="seat-foot">
        <Icon name="alert-triangle" size={13} />
        <span>
          This is a snapshot, not a live view — the console runs no clock of its own. Refresh to
          re-read the seat.
        </span>
      </p>
    </Panel>
  );
}
