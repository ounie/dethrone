"use client";

import { useRef } from "react";
import Dialog from "./dialog";
import type { AutonomyChallenge } from "@/lib/agent";
import { money } from "@/lib/format";

/**
 * The question the operator has to read before a machine can spend their money.
 *
 * ## Same protocol as a payment, for the same reason
 *
 * Every value below arrives in a `CONSOLE_AUTONOMY_CONFIRM_REQUIRED` response —
 * the payer, the per-action cap, the sitting ceiling, and the exact sentence to
 * echo back. The route refuses unless the echo matches what it recomputes at
 * that moment, so a ceiling tightened while this dialog was open invalidates the
 * confirmation and the operator reads the new terms.
 *
 * The client does not decide to show this and does not compose it. A mode the
 * browser could assert for itself would be bypassable by anything that can POST,
 * which is precisely the argument `confirm-dialog.tsx` makes about money.
 *
 * ## And the asymmetry
 *
 * Turning this ON costs a dialog you have to read. Turning it OFF is one click
 * with no confirmation at all — see the chip in `chat-pane.tsx`. That is the
 * ceiling's one-way-tightening doctrine inverted: restraint should always be
 * cheaper than permission.
 */
export default function AutonomyDialog({
  challenge,
  rejected,
  onCancel,
  onConfirm,
}: {
  challenge: AutonomyChallenge;
  /** Set when a previous echo was refused, so the operator learns why. */
  rejected?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // The SAFE choice takes focus. Return should not grant authority.
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog labelledBy="autonomy-title" onCancel={onCancel} initialFocus={cancelRef}>
      <>
        <h2 className="display" id="autonomy-title">
          Let the agent act without asking?
        </h2>

        <dl>
          <dt>Paid from</dt>
          <dd>{challenge.operator}</dd>

          <dt>Most it may spend at once</dt>
          <dd data-amount="true">{money(challenge.perActionCapCents)}</dd>

          <dt>Most this sitting may spend</dt>
          <dd data-amount="true">{money(challenge.capCents)}</dd>
        </dl>

        <p className="note">
          {/* 1. What stops happening. */}
          The agent will no longer ask before signing or paying. A signed or paid command runs the
          moment it decides to run one, with no dialog and no click from you.
        </p>

        <p className="note">
          {/* 2. What still holds — and honestly what it is. */}
          The ceiling above still refuses anything beyond it, and an action the arena prices above
          the per-action cap is refused before a signature exists. Both are seatbelts in this
          process for this sitting. Neither is escrow, and neither protects a host you do not
          control.
        </p>

        <p className="note">
          {/* 3. What cannot be undone. */}
          Settled USDC cannot be recalled and a signature cannot be unsigned. Releasing a character
          is still yours alone — the agent never gets that one, in either mode.
        </p>

        <p className="note">
          {/* 4. Where it ends. */}
          One click turns this off again. It expires on its own, it ends when this process stops,
          and it is not remembered across a reload.
        </p>

        {rejected && (
          <p className="disabled-reason">
            The previous confirmation was refused ({rejected}). These are the current terms.
          </p>
        )}

        <div className="confirm-actions">
          <button type="button" className="btn-quiet" ref={cancelRef} onClick={onCancel}>
            Keep asking me
          </button>
          {/* Teal, and no data-paid. This button changes a mode; it settles
              nothing. The ember button is in the Command pane, where it belongs. */}
          <button type="button" className="run" onClick={onConfirm}>
            Turn on full autonomy
          </button>
        </div>
      </>
    </Dialog>
  );
}
