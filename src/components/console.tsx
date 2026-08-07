"use client";

import { useCallback, useState } from "react";
import CommandPane from "./command-pane";
import ConfirmDialog, { type ConfirmRequest } from "./confirm-dialog";
import Rail from "./rail";
import ResponsePane, { type Envelope } from "./response-pane";
import type { Capabilities, StakeRange } from "@/lib/capability";
import { COMMANDS, type Command } from "@/lib/commands";

/**
 * The three panes.
 *
 * Everything this component knows, it was told. It holds no rules, reads no
 * clock, and computes no price — the amount in the confirmation comes from a
 * 428 the server sent, and the capability of every command was decided
 * server-side and shipped as data.
 *
 * There is exactly one place a request originates in this whole client tree,
 * and it is `POST /api/act` below. `test/one-fetch.test.ts` fails on a second.
 */

const FIRST = COMMANDS[0];

export default function Console({
  operator,
  capabilities,
  forgeNote,
  stakeRange,
  ceilingEnabled,
}: {
  operator: string | null;
  capabilities: Capabilities;
  forgeNote: string | null;
  stakeRange: StakeRange;
  ceilingEnabled: boolean;
}) {
  const [active, setActive] = useState<Command>(FIRST);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [envelope, setEnvelope] = useState<Envelope | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<
    { request: ConfirmRequest; confirm: { amountCents: number; payer: string } } | null
  >(null);

  const record = useCallback((cmd: Command, status: number | string) => {
    const stamp = new Date().toLocaleTimeString();
    setLog((prev) => [`${stamp}  ${cmd.method} ${cmd.id} → ${status}`, ...prev].slice(0, 40));
  }, []);

  const send = useCallback(
    async (cmd: Command, confirm?: { amountCents: number; payer: string }) => {
      setBusy(true);
      try {
        const res = await fetch("/api/act", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: cmd.id, args, confirm }),
        });
        const data = (await res.json()) as Envelope;

        // The server asked for a confirmation and named the terms. Show them
        // verbatim and resubmit the same numbers — the client never invents an
        // amount, and the route refuses an echo that does not match what it
        // computed for itself.
        if (res.status === 428 && data.error?.detail) {
          const detail = data.error.detail as {
            amountCents?: number;
            payer?: string;
            callerPriced?: boolean;
            destructive?: boolean;
          };
          setPending({
            request: {
              commandLabel: cmd.label,
              amountCents: detail.amountCents ?? 0,
              payer: detail.payer ?? operator ?? "unknown",
              callerPriced: detail.callerPriced,
              destructive: detail.destructive,
            },
            confirm: {
              amountCents: detail.amountCents ?? 0,
              payer: detail.payer ?? operator ?? "",
            },
          });
          return;
        }

        setEnvelope(data);
        record(cmd, data.status ?? data.error?.code ?? res.status);
      } catch (err) {
        setEnvelope({
          error: {
            code: "CONSOLE_TRANSPORT",
            message: err instanceof Error ? err.message : String(err),
          },
        });
        record(cmd, "CONSOLE_TRANSPORT");
      } finally {
        setBusy(false);
      }
    },
    [args, operator, record],
  );

  return (
    <>
      <div className="console">
        <Rail
          capabilities={capabilities}
          activeId={active.id}
          onSelect={(cmd) => {
            setActive(cmd);
            setArgs({});
          }}
        />

        <CommandPane
          cmd={active}
          capability={capabilities[active.id] ?? { enabled: true }}
          args={args}
          busy={busy}
          stakeRange={stakeRange}
          forgeNote={forgeNote}
          onArg={(name, value) => setArgs((prev) => ({ ...prev, [name]: value }))}
          onRun={() => void send(active)}
        />

        <ResponsePane envelope={envelope} log={log} />
      </div>

      {pending && (
        <ConfirmDialog
          request={pending.request}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const confirm = pending.confirm;
            setPending(null);
            void send(active, confirm);
          }}
        />
      )}

      {!ceilingEnabled && (
        <p className="footnote">
          The spend ceiling is <strong>disabled</strong> on this deploy: serverless invocations do
          not share memory, so a per-process counter cannot bound a sitting. It says so rather than
          showing a number that would reset between two clicks.
        </p>
      )}
    </>
  );
}
