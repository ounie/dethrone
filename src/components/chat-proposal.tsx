"use client";

import Icon from "./icon";
import type { Capability } from "@/lib/capability";
import { byId } from "@/lib/commands";
import { money } from "@/lib/format";
import type { Proposal } from "@/lib/agent";

/**
 * Something the agent wants to do, that only the operator may do.
 *
 * ## Two ways to say yes, and neither is a second execution path
 *
 * **Approve** issues the proposal through `POST /api/act` — the same call the
 * Run button makes, with the same arguments the card is displaying. **Load into
 * the command pane** fills the form instead, for when you want to edit
 * something first.
 *
 * This card used to offer only the second, and the argument for that is worth
 * keeping because most of it still holds. It ran:
 *
 * 1. An inline "approve" honest about a paid command would have to wear ember,
 *    and there would then be two ember buttons on screen.
 * 2. The form is the audit surface. An agent cannot construct an argument the
 *    operator never sees.
 * 3. It is a state lift, not machinery.
 * 4. The money path is untouched. The confirmation stays a protocol step.
 *
 * (2) and (4) survive unchanged, and they were the load-bearing ones. Every
 * argument is printed on this card before anything is approved, so nothing is
 * hidden by skipping the form — the `<pre>` above the buttons is the same data
 * the fields would hold. And approving reaches the arena through the one
 * guarded route, so the tier gate, the ceiling, the host check and the
 * signature all run exactly as they do for a manual Run.
 *
 * (1) survives too, and it is why **Approve is teal**. A paid command approved
 * here does not settle: `/api/act` answers 428, and `confirm-dialog.tsx` opens
 * with the real amount the server computed. The consequential button still
 * lives in that modal, still wears ember, and is still the only thing on screen
 * that settles an amount. Approve is a request to be asked properly.
 *
 * Only (3) is genuinely traded away — this is now a second CALLER of `send`,
 * not a second implementation of it — and the extra click it was buying was
 * being paid on free reads and signed no-ops too, where there was nothing to
 * protect.
 */
export default function ChatProposal({
  proposal,
  capability,
  loaded,
  busy,
  onLoad,
  onApprove,
}: {
  proposal: Proposal;
  capability: Capability | undefined;
  loaded: boolean;
  /** True while any request is in flight, including this one. */
  busy: boolean;
  onLoad: () => void;
  /** Issue it now, through the same route the Run button uses. */
  onApprove: () => void;
}) {
  const cmd = byId(proposal.commandId);
  if (!cmd) return null;

  const enabled = capability?.enabled !== false;
  const liveCents = capability?.liveCents;

  return (
    <div className="proposal" data-tier={cmd.tier} data-loaded={loaded}>
      <div className="proposal-head">
        <span className="proposal-title">
          <Icon name="swords" size={13} />
          {cmd.label}
        </span>
        <span className="price-badge" data-tier={cmd.tier}>
          {liveCents !== undefined ? money(liveCents) : cmd.price}
        </span>
      </div>

      <p className="proposal-why">{proposal.why}</p>

      {Object.keys(proposal.args).length > 0 && (
        <pre className="tool-args">
          {Object.entries(proposal.args)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")}
        </pre>
      )}

      {enabled ? (
        <div className="proposal-actions">
          {/*
            Teal, and `btn-quiet` rather than `run`. On a paid command this
            button does not settle anything — it earns a 428 and the real
            confirmation dialog, which is where the ember lives. Wearing ember
            here would put the money colour on a control that does not move
            money, on the same screen as the one that does.
          */}
          <button
            type="button"
            className="btn-quiet proposal-approve"
            disabled={busy}
            onClick={onApprove}
            aria-label={`Approve and run ${cmd.label}`}
          >
            <Icon name="shield-check" size={12} />
            {cmd.tier === "paid" ? "Approve — you will be asked to confirm" : "Approve and run"}
          </button>
          <button
            type="button"
            className="btn-quiet proposal-load"
            disabled={busy}
            onClick={onLoad}
            aria-label={`Load ${cmd.label} into the command pane`}
          >
            <Icon name="terminal" size={12} />
            {loaded ? "Loaded — check the fields" : "Edit first"}
          </button>
        </div>
      ) : (
        // The agent proposing something this deploy cannot run is not an error
        // state. It is the same disabled row the catalogue already shows, with
        // the same sentence, which the server wrote.
        <p className="disabled-reason">{capability?.reason}</p>
      )}
    </div>
  );
}
