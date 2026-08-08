"use client";

import { useRef } from "react";
import Dialog from "./dialog";

/**
 * The confirmation.
 *
 * ## The server asks for this, the client does not decide to show it
 *
 * Every field below arrives in a `CONSOLE_CONFIRM_REQUIRED` response: the
 * amount the server computed, and the address the server will pay from. The
 * dialog echoes them back unchanged, and the route refuses unless the echo
 * matches what it independently computed.
 *
 * That ordering is the whole design. A dialog that the *browser* decides to
 * show, with an amount the *browser* computed, is bypassable by anything that
 * can POST to `/api/act`, and it is not a thing a test can assert. Making the
 * confirmation a protocol step — 428, then a matching echo — turns a UI habit
 * into an invariant, and it means the client never computes money.
 */

export interface ConfirmRequest {
  commandLabel: string;
  amountCents: number;
  payer: string;
  callerPriced?: boolean;
  destructive?: boolean;
}

export default function ConfirmDialog({
  request,
  onCancel,
  onConfirm,
}: {
  request: ConfirmRequest;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(request.amountCents / 100);

  return (
    <Dialog labelledBy="confirm-title" onCancel={onCancel} initialFocus={confirmRef}>
      <>
        <h2 className="display" id="confirm-title">
          {request.destructive ? "Destroy this claim?" : "Settle this payment?"}
        </h2>

        <dl>
          <dt>Command</dt>
          <dd>{request.commandLabel}</dd>

          {!request.destructive && (
            <>
              <dt>Amount</dt>
              <dd data-amount="true">
                {request.callerPriced ? `up to ${money}` : money}
              </dd>
            </>
          )}

          <dt>{request.destructive ? "Signed by" : "Paid from"}</dt>
          <dd>{request.payer}</dd>
        </dl>

        <p className="note">
          {request.destructive
            ? "This cannot be undone, and it does not transfer to anyone."
            : request.callerPriced
              ? "The arena quotes the final price. Anything above the amount shown is refused before a signature exists."
              : "USDC settles the moment the handler succeeds. A refusal costs nothing."}
        </p>

        <div className="confirm-actions">
          <button type="button" className="btn-quiet" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="run"
            data-paid={!request.destructive}
            ref={confirmRef}
            onClick={onConfirm}
          >
            {request.destructive ? "Release it" : `Settle ${money}`}
          </button>
        </div>
      </>
    </Dialog>
  );
}
