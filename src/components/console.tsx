"use client";

import { useCallback, useState } from "react";
import CommandPane from "./command-pane";
import ConfirmDialog, { type ConfirmRequest } from "./confirm-dialog";
import Masthead, { type Ceiling } from "./masthead";
import Rail from "./rail";
import ResponseLog, { type LogRow } from "./response-log";
import ResponsePane, { type Envelope } from "./response-pane";
import SeatState, { type SeatSnapshot } from "./seat-state";
import type { Capabilities, StakeRange } from "@/lib/capability";
import { COMMANDS, type Command } from "@/lib/commands";
import { logTime } from "@/lib/format";

/**
 * The instrument panel.
 *
 * Everything this component knows, it was told. It holds no rules, runs no
 * clock, and computes no price: the amount in a confirmation comes from a 428
 * the server sent, and every command's availability was decided server-side and
 * shipped as data.
 *
 * There is exactly one place a request originates in this whole client tree,
 * and it is the `fetch("/api/act")` below. `test/one-fetch.test.ts` fails on a
 * second.
 */

const FIRST = COMMANDS[0];

export default function Console({
  operator,
  baseUrl,
  capabilities,
  forgeNote,
  stakeRange,
  ceiling,
  seat,
}: {
  operator: string | null;
  baseUrl: string;
  capabilities: Capabilities;
  forgeNote: string | null;
  stakeRange: StakeRange;
  ceiling: Ceiling;
  seat: SeatSnapshot;
}) {
  const [active, setActive] = useState<Command>(FIRST);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [envelope, setEnvelope] = useState<Envelope | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<Ceiling>(ceiling);
  const [pending, setPending] = useState<
    { request: ConfirmRequest; confirm: { amountCents: number; payer: string } } | null
  >(null);

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
        // amount, and the route refuses an echo it did not compute itself.
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
        if (data.ceiling?.enabled) {
          setLive((prev) => ({
            ...prev,
            spentCents: data.ceiling?.spentCents ?? prev.spentCents,
            capCents: data.ceiling?.cap ?? prev.capCents,
          }));
        }

        setLog((prev) =>
          [
            {
              at: logTime(new Date()),
              method: cmd.method,
              path: data.request?.path ?? cmd.path,
              status: data.status ?? data.error?.code ?? res.status,
              settled: data.settled === true,
              amountCents: confirm?.amountCents ?? null,
              ms: data.ms ?? null,
            },
            ...prev,
          ].slice(0, 25),
        );
      } catch (err) {
        setEnvelope({
          error: {
            code: "CONSOLE_TRANSPORT",
            message: err instanceof Error ? err.message : String(err),
          },
        });
      } finally {
        setBusy(false);
      }
    },
    [args, operator],
  );

  return (
    <>
      <Masthead
        baseUrl={baseUrl}
        operator={operator}
        reachable={seat.reachable}
        ceiling={live}
      />

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

        <ResponsePane envelope={envelope} />

        <ResponseLog rows={log} />

        <SeatState seat={seat} />
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
    </>
  );
}
