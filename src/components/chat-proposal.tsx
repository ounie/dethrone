"use client";

import Icon from "./icon";
import type { Capability } from "@/lib/capability";
import { byId } from "@/lib/commands";
import { money } from "@/lib/format";
import type { Proposal } from "@/lib/agent";

/**
 * Something the agent wants to do, that only the operator may do.
 *
 * ## This card does not run anything, and that is the whole point
 *
 * Its button loads the command into the pane below, pre-filled with the agent's
 * arguments. The operator then sees the real form, the real preview of the body
 * that will be sent, the real price badge, and presses the real Run button —
 * hitting the same 428 confirmation any manual command hits.
 *
 * Four reasons it works this way rather than executing inline:
 *
 * 1. An inline "approve" honest about a paid command would have to wear ember,
 *    and there would then be two ember buttons on screen. Ember means one thing
 *    and stops meaning it the moment a second element wears it.
 * 2. The form is the audit surface. An agent cannot construct an argument the
 *    operator never sees, because the argument arrives as an editable field.
 * 3. It is a state lift, not machinery: `console.tsx` already owns `active` and
 *    `args`, so this is two setters rather than a second execution path.
 * 4. The money path is untouched. The confirmation stays a protocol step.
 *
 * It costs one extra click. That is the correct price for a machine spending
 * someone else's money.
 */
export default function ChatProposal({
  proposal,
  capability,
  loaded,
  onLoad,
}: {
  proposal: Proposal;
  capability: Capability | undefined;
  loaded: boolean;
  onLoad: () => void;
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
        <button
          type="button"
          className="btn-quiet proposal-load"
          onClick={onLoad}
          aria-label={`Load ${cmd.label} into the command pane`}
        >
          <Icon name="terminal" size={12} />
          {loaded ? "Loaded — check the fields, then Run" : "Load into the command pane"}
        </button>
      ) : (
        // The agent proposing something this deploy cannot run is not an error
        // state. It is the same disabled row the catalogue already shows, with
        // the same sentence, which the server wrote.
        <p className="disabled-reason">{capability?.reason}</p>
      )}
    </div>
  );
}
