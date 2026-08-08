"use client";

import ChatProposal from "./chat-proposal";
import Icon from "./icon";
import type { Turn } from "@/lib/agent";
import type { Capabilities } from "@/lib/capability";
import { money, shortAddress } from "@/lib/format";

/**
 * What was said and what was done, in order.
 *
 * ## No markdown, ever
 *
 * Agent text is split on blank lines into paragraphs and rendered as text.
 * There is no markdown renderer and no `dangerouslySetInnerHTML`, and that is a
 * security decision rather than a scope one: a markdown renderer is a component
 * that lets model output produce things which look like console chrome — a
 * heading that reads like a system message, a link that is not what it says.
 * On a screen where the chrome is the difference between "proposed" and
 * "settled", that is not a trade worth making for prettier output.
 *
 * ## Tool rows are the same shape as catalogue rows
 *
 * Same three-column geometry as `.cmd` in the rail, same `data-method` colours.
 * An agent's tool call and an operator's click are the same event, and rendering
 * them alike is the claim that the agent is a second keyboard rather than a
 * second kind of actor.
 */
export default function ChatTranscript({
  turns,
  capabilities,
  loadedProposals,
  onLoadCommand,
}: {
  turns: readonly Turn[];
  capabilities: Capabilities;
  loadedProposals: ReadonlySet<string>;
  onLoadCommand: (commandId: string, args: Record<string, string>) => void;
}) {
  if (turns.length === 0) {
    return (
      <div className="chat-empty">
        <p>Ask about the seat, the queue, a fighter&rsquo;s legal actions.</p>
        <p className="muted">
          Reads run straight away. Anything that signs or spends comes back as a proposal you run
          yourself.
        </p>
      </div>
    );
  }

  return (
    <div className="chat-log" aria-live="polite">
      {turns.map((turn, i) => {
        const key = `${turn.kind}-${i}`;

        if (turn.kind === "you") {
          return (
            <div className="turn" data-who="you" key={key}>
              <span className="turn-time num">{turn.at}</span>
              {turn.text}
            </div>
          );
        }

        if (turn.kind === "agent") {
          return (
            <div className="turn" data-who="agent" data-pending={turn.pending} key={key}>
              <span className="turn-time num">{turn.at}</span>
              {turn.text
                .split(/\n{2,}/)
                .filter(Boolean)
                .map((para, j) => (
                  <p key={j}>{para}</p>
                ))}
            </div>
          );
        }

        if (turn.kind === "proposal") {
          return (
            <ChatProposal
              key={key}
              proposal={turn.proposal}
              capability={capabilities[turn.proposal.commandId]}
              loaded={loadedProposals.has(turn.proposal.commandId)}
              onLoad={() => onLoadCommand(turn.proposal.commandId, turn.proposal.args)}
            />
          );
        }

        if (turn.kind === "refusal") {
          return (
            <div className="turn" data-who="refusal" key={key}>
              <Icon name="alert-triangle" size={12} />
              {turn.code}
              {turn.detail ? ` — ${turn.detail}` : ""}
            </div>
          );
        }

        const r = turn.record;
        const failed = typeof r.status === "number" ? r.status >= 400 : !!r.errorCode;

        return (
          <div key={key}>
            <div className="tool-row" data-state={r.status === null ? "running" : "done"}>
              <span className="method" data-method={r.method}>
                {r.method}
              </span>
              <span className="tool-path ellipsis" title={r.path}>
                {r.path}
              </span>
              {r.settled && (
                <span className="status-chip" data-tone="ember">
                  settled
                </span>
              )}
              <span className="status-chip num" data-tone={failed ? "bad" : "ok"}>
                {/* The console's or the arena's own code. Never a sentence
                    invented here — see action-picker.tsx for the precedent. */}
                {r.errorCode ?? r.status}
              </span>
            </div>
            {r.terms && (
              // Shown even though the operator did not click: under full
              // autonomy these are the terms that were agreed on their behalf,
              // and they should be able to read them after the fact.
              <p className="tool-args">
                agreed {money(r.terms.amountCents)} · payer {shortAddress(r.terms.payer)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
