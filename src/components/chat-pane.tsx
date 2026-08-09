"use client";

import { useCallback, useState } from "react";
import AutonomyDialog from "./autonomy-dialog";
import AutonomyLockedDialog from "./autonomy-locked-dialog";
import ChatTranscript from "./chat-transcript";
import Icon from "./icon";
import ModelPicker from "./model-picker";
import Panel from "./panel";
import type { AgentConfig, AutonomyChallenge, ChatEventWire, ProviderId, Turn } from "@/lib/agent";
import type { Capabilities } from "@/lib/capability";
import { logTime } from "@/lib/format";

/**
 * The agent, and the one place this component can send anything: `/api/chat`.
 *
 * ## What it holds and what it deliberately does not
 *
 * It holds the transcript, because this console persists nothing — closing the
 * tab ends the conversation, and there is no session table to leak.
 *
 * It does **not** hold the authority. The autonomy chip below renders a fact the
 * server reported; clicking it asks the server to change that fact, and the
 * server may refuse. There is no local flag that means "full", because a local
 * flag would be a mode the browser had granted itself.
 *
 * ## Where tool results go
 *
 * Up, into the same `ResponsePane` and `ResponseLog` a manual Run writes to.
 * One record of what this console did, regardless of which keyboard pressed the
 * key — which is the claim the whole design is making.
 */

interface StatusReply {
  autonomy: { active: boolean; offerable: boolean; reason?: string };
}

export default function ChatPane({
  agent,
  capabilities,
  busy,
  onBusy,
  onLoadCommand,
  onRunCommand,
  onEnvelope,
}: {
  agent: AgentConfig;
  capabilities: Capabilities;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onLoadCommand: (commandId: string, args: Record<string, string>) => void;
  /** Approve a proposal: issues it through the same route the Run button uses. */
  onRunCommand: (commandId: string, args: Record<string, string>) => void;
  /** A tool result, handed to the panes that already render envelopes. */
  onEnvelope: (event: ChatEventWire) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [provider, setProvider] = useState<ProviderId | null>(agent.defaultProviderId);
  const [model, setModel] = useState(agent.defaultModelId ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loaded, setLoaded] = useState<Set<string>>(new Set());

  const [autonomy, setAutonomy] = useState(agent.autonomy.active);
  const [lockedOpen, setLockedOpen] = useState(false);
  const [challenge, setChallenge] = useState<{
    challenge: AutonomyChallenge;
    rejected?: string;
  } | null>(null);

  const append = useCallback((...next: Turn[]) => setTurns((prev) => [...prev, ...next]), []);

  /** Turning autonomy OFF is one call and needs nothing. Turning it ON is a handshake. */
  const toggleAutonomy = useCallback(
    async (enable: boolean, confirm?: AutonomyChallenge) => {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "autonomy",
          enable,
          ...(confirm
            ? {
                confirm: {
                  operator: confirm.operator,
                  acknowledgement: confirm.acknowledgement,
                  nonce: confirm.nonce,
                },
              }
            : {}),
        }),
      });
      const data = (await res.json()) as {
        active?: boolean;
        error?: { code: string; detail?: AutonomyChallenge & { rejected?: string } };
      };

      // The server asked for a confirmation and named the terms. Show them
      // verbatim; the dialog echoes them back and the route refuses an echo it
      // did not compute.
      if (res.status === 428 && data.error?.detail) {
        setChallenge({ challenge: data.error.detail, rejected: data.error.detail.rejected });
        return;
      }

      setChallenge(null);
      if (res.ok) setAutonomy(data.active === true);
      else append({ kind: "refusal", at: logTime(new Date()), code: data.error?.code ?? "ERROR" });
    },
    [append],
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !provider || !model || busy) return;

    setDraft("");
    append(
      { kind: "you", at: logTime(new Date()), text },
      { kind: "agent", at: logTime(new Date()), text: "", pending: true },
    );
    onBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "turn", provider, model, message: text, history: [] }),
      });
      const data = (await res.json()) as {
        events?: ChatEventWire[];
        mode?: string;
        error?: { code: string; detail?: { reason?: string } };
      };

      const at = logTime(new Date());

      // Drop the pending placeholder before appending the real turns.
      setTurns((prev) => prev.filter((t) => !(t.kind === "agent" && t.pending)));

      if (!res.ok || !data.events) {
        append({
          kind: "refusal",
          at,
          code: data.error?.code ?? `HTTP_${res.status}`,
          detail: data.error?.detail?.reason,
        });
        return;
      }

      if (data.mode) setAutonomy(data.mode === "full");

      const next: Turn[] = [];
      for (const event of data.events) {
        if (event.type === "text") {
          next.push({ kind: "agent", at, text: event.text });
        } else if (event.type === "proposal") {
          next.push({
            kind: "proposal",
            at,
            proposal: { commandId: event.commandId, args: event.args, why: event.why },
          });
        } else if (event.type === "refused") {
          next.push({ kind: "refusal", at, code: event.code, detail: event.detail });
        } else {
          next.push({
            kind: "tool",
            at,
            record: {
              commandId: event.commandId,
              method: event.method,
              path: event.path,
              args: event.args,
              status: event.status,
              ms: event.ms,
              settled: event.settled,
              errorCode: event.errorCode,
              terms: event.terms,
            },
          });
          // The envelope belongs in the response pane and the session log, the
          // same place a manual Run puts it.
          onEnvelope(event);
        }
      }
      append(...next);
    } catch (err) {
      setTurns((prev) => prev.filter((t) => !(t.kind === "agent" && t.pending)));
      append({
        kind: "refusal",
        at: logTime(new Date()),
        code: "CONSOLE_TRANSPORT",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      onBusy(false);
    }
  }, [append, busy, draft, model, onBusy, onEnvelope, provider]);

  const disabled = !agent.enabled;

  return (
    <>
      <Panel
        icon="message-square"
        title="Agent"
        className="pane-chat"
        actions={
          <>
            <button
              type="button"
              className="chat-chip"
              disabled={disabled}
              onClick={() => setPickerOpen((v) => !v)}
              title="Choose a provider and model"
            >
              <Icon name="compass" size={12} />
              <span className="ellipsis">{model || "no model"}</span>
            </button>

            {/*
              The mode, and — when it cannot be changed — the way to find out
              why. The chip stays LIVE while autonomy is unavailable rather than
              going grey: a disabled control with a tooltip is a dead end for
              anyone on a touch screen or a keyboard, and the reason is exactly
              what an operator is reaching for when they press it.

              `disabled` here is the pane's own busy flag, never the capability.
            */}
            <button
              type="button"
              className="chat-chip"
              data-mode={autonomy ? "full" : agent.autonomy.offerable ? "reads" : "locked"}
              disabled={disabled}
              aria-haspopup={!agent.autonomy.offerable ? "dialog" : undefined}
              title={
                agent.autonomy.offerable
                  ? "How much the agent may do without asking"
                  : "Why the agent asks first"
              }
              onClick={() =>
                agent.autonomy.offerable ? void toggleAutonomy(!autonomy) : setLockedOpen(true)
              }
            >
              <Icon name={autonomy ? "alert-triangle" : "lock"} size={12} />
              {autonomy ? "Full autonomy" : "Free reads only"}
            </button>
          </>
        }
      >
        {disabled ? (
          <div className="pane-body empty small">
            <Icon name="message-square" size={24} />
            <p>No agent on this deploy.</p>
            <p className="muted">{agent.reason}</p>
          </div>
        ) : (
          <>
            {pickerOpen && (
              <ModelPicker
                agent={agent}
                providerId={provider}
                modelId={model}
                disabled={busy}
                onChange={(p, m) => {
                  setProvider(p);
                  setModel(m);
                }}
              />
            )}

            <ChatTranscript
              turns={turns}
              capabilities={capabilities}
              busy={busy || disabled}
              loadedProposals={loaded}
              onRunCommand={onRunCommand}
              onLoadCommand={(id, args) => {
                setLoaded((prev) => new Set(prev).add(id));
                onLoadCommand(id, args);
              }}
            />

            <div className="composer">
              <textarea
                value={draft}
                disabled={busy}
                placeholder="Ask about the arena…"
                aria-label="Message the agent"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              {/* Teal. Never data-paid. This sends a sentence. */}
              <button
                type="button"
                className="run"
                disabled={busy || !draft.trim() || !model}
                onClick={() => void send()}
              >
                <Icon name="terminal" size={14} />
                {busy ? "Working…" : "Send"}
              </button>
            </div>
          </>
        )}
      </Panel>

      {challenge && (
        <AutonomyDialog
          challenge={challenge.challenge}
          rejected={challenge.rejected}
          onCancel={() => setChallenge(null)}
          onConfirm={() => void toggleAutonomy(true, challenge.challenge)}
        />
      )}

      {lockedOpen && (
        <AutonomyLockedDialog
          reason={
            agent.autonomy.reason ?? "Full autonomy is not offered on this deploy."
          }
          onClose={() => setLockedOpen(false)}
        />
      )}
    </>
  );
}
