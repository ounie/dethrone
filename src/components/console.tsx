"use client";

import { useCallback, useState } from "react";
import ChatPane from "./chat-pane";
import CommandPane from "./command-pane";
import ConfirmDialog, { type ConfirmRequest } from "./confirm-dialog";
import FightersPane from "./fighters-pane";
import Masthead, { type Ceiling, type House, type Wallet } from "./masthead";
import Rail from "./rail";
import ResponseLog, { type LogRow } from "./response-log";
import ResponsePane from "./response-pane";
import SeatState, { type SeatSnapshot } from "./seat-state";
import StandingPane from "./standing-pane";
import type { AgentConfig, ChatEventWire } from "@/lib/agent";
import type { Capabilities, StakeRange } from "@/lib/capability";
import type { Standing } from "@/lib/standing";
import type { Envelope } from "@/lib/envelope";
import { byId, COMMANDS, type Command } from "@/lib/commands";
import { logTime } from "@/lib/format";

/**
 * The instrument panel.
 *
 * Everything this component knows, it was told. It holds no rules, runs no
 * clock, and computes no price: the amount in a confirmation comes from a 428
 * the server sent, and every command's availability was decided server-side and
 * shipped as data.
 *
 * Every request this client tree makes goes to **one destination**, and it is
 * the `fetch("/api/act")` below — the same literal `action-picker.tsx` and
 * `fighters-pane.tsx` use. `test/one-fetch.test.ts` enforces the destination,
 * not the number of call sites, and the distinction is the point: several
 * components may ask, and every one of them is asking through the single
 * guarded path. A second *address* is what the test fails on.
 */

const FIRST = COMMANDS[0];

export default function Console({
  operator,
  baseUrl,
  capabilities,
  agent,
  forgeNote,
  stakeRange,
  sequenceLength,
  ceiling,
  wallet,
  house,
  seat,
  standing,
}: {
  operator: string | null;
  baseUrl: string;
  capabilities: Capabilities;
  agent: AgentConfig;
  forgeNote: string | null;
  stakeRange: StakeRange;
  /** The canon's published sequence length, or null if it publishes none. */
  sequenceLength: number | null;
  ceiling: Ceiling;
  wallet: Wallet | null;
  /** The operator's House, read from the arena. Null when it published none. */
  house: House | null;
  seat: SeatSnapshot;
  /** Where the operator stands. Read on the server; never derived here. */
  standing: Standing;
}) {
  const [active, setActive] = useState<Command>(FIRST);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [envelope, setEnvelope] = useState<Envelope | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<Ceiling>(ceiling);
  const [pending, setPending] = useState<{
    cmd: Command;
    args: Record<string, string>;
    request: ConfirmRequest;
    confirm: { amountCents: number; payer: string };
  } | null>(null);

  /*
    A confirmation does not survive the wallet it names.

    `router.refresh()` re-renders the server tree and deliberately KEEPS client
    state, so an open dialog genuinely outlives a wallet switch — it would sit
    there naming an address that is no longer signing, and the operator would
    press Confirm on terms nobody now holds. `/api/act` refuses that echo, which
    is the guarantee; this is so the screen agrees with it rather than making
    the operator discover it by clicking.

    Adjusted during render rather than in an effect, which is React's own
    prescription for "reset state when a prop changes" — an effect would render
    the stale dialog once, then blank it, and the lint rule that says so is
    right.
  */
  const [signedAs, setSignedAs] = useState(operator);
  if (operator !== signedAs) {
    setSignedAs(operator);
    setPending(null);
  }

  /**
   * One envelope, absorbed.
   *
   * Extracted so the agent's tool results and the operator's own Run land in
   * the response pane, the session log and the ceiling meter through exactly
   * one function. Two paths would eventually disagree about what counts as a
   * settled command, and the screen would then hold two answers about money.
   */
  const absorb = useCallback(
    (
      data: Envelope,
      meta: { method: string; path: string; amountCents: number | null },
    ) => {
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
            method: meta.method,
            path: data.request?.path ?? meta.path,
            status: data.status ?? data.error?.code ?? "—",
            settled: data.settled === true,
            amountCents: meta.amountCents,
            ms: data.ms ?? null,
          },
          ...prev,
        ].slice(0, 25),
      );
    },
    [],
  );

  /*
    How many times a command has been armed this sitting.

    A counter and not a boolean, because the interesting event is "armed
    AGAIN" — arming the same command twice has to be as visible as arming a
    different one, and a boolean that is already true says nothing the second
    time. `CommandPane` watches it and does the one thing this needed: brings
    itself into view and says, briefly and visibly, that it changed.

    The problem it solves is real and was reported from the chair: pressing
    Forge in the Fighters panel silently rewrote a card somewhere else on the
    screen, and an operator who did not already know the pane existed had no
    reason to look at it. An affordance nobody notices is an affordance nobody
    has.
  */
  const [armedAt, setArmedAt] = useState(0);

  /** A proposal, accepted. Pre-fills the form; it does not run anything. */
  const loadCommand = useCallback((commandId: string, next: Record<string, string>) => {
    const cmd = byId(commandId);
    if (!cmd) return;
    setActive(cmd);
    setArgs(next);
    setArmedAt((n) => n + 1);
  }, []);

  /**
   * Issue one command. The single place this client tree reaches the arena.
   *
   * `sendArgs` is explicit rather than closed over, because there are now two
   * callers with two different argument sources: the command pane, which sends
   * the form's `args`, and an approved agent proposal, which sends the
   * arguments printed on its own card. Reading `args` here regardless would
   * have made "Approve" issue whatever happened to be typed in the form — the
   * wrong request, silently, and the one that reads as approved.
   */
  const send = useCallback(
    async (
      cmd: Command,
      sendArgs: Record<string, string>,
      confirm?: { amountCents: number; payer: string },
    ) => {
      setBusy(true);
      try {
        const res = await fetch("/api/act", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: cmd.id, args: sendArgs, confirm }),
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
            // The command AND its arguments, captured. Resubmitting from
            // `active`/`args` would confirm one request and send another if the
            // operator touched the form — or if the 428 came from a proposal,
            // which has no form at all.
            cmd,
            args: sendArgs,
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

        absorb(data, {
          method: cmd.method,
          path: cmd.path,
          amountCents: confirm?.amountCents ?? null,
        });
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
    [absorb, operator],
  );

  /**
   * An agent proposal, approved.
   *
   * Not a second execution path — it is `send` with the proposal's own
   * arguments, so every gate on `/api/act` runs in the same order it does for a
   * manual Run, and a paid command still comes back 428 for the confirmation
   * dialog. It also loads the command into the pane, so what was approved stays
   * visible afterwards rather than only in the log.
   *
   * Declared AFTER `send` and depending on it, rather than earlier with an empty
   * dependency list: an approval that closed over a stale `send` would post with
   * a stale `operator`, and the confirmation echo would name the wrong payer.
   */
  const runCommand = useCallback(
    (commandId: string, next: Record<string, string>) => {
      const cmd = byId(commandId);
      if (!cmd) return;
      setActive(cmd);
      setArgs(next);
      void send(cmd, next);
    },
    [send],
  );

  /** A tool the agent ran. Same envelope, same panes, same log. */
  const onAgentEvent = useCallback(
    (event: ChatEventWire) => {
      if (event.type !== "executed") return;
      absorb(event.body as Envelope, {
        method: event.method,
        path: event.path,
        amountCents: event.terms?.amountCents ?? null,
      });
    },
    [absorb],
  );

  return (
    <>
      <Masthead
        baseUrl={baseUrl}
        operator={operator}
        reachable={seat.reachable}
        ceiling={live}
        wallet={wallet}
        house={house}
        onTightened={(cap) => setLive((prev) => ({ ...prev, capCents: cap }))}
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

        <ChatPane
          agent={agent}
          capabilities={capabilities}
          busy={busy}
          onBusy={setBusy}
          onLoadCommand={loadCommand}
          onRunCommand={runCommand}
          onEnvelope={onAgentEvent}
        />

        <CommandPane
          cmd={active}
          capability={capabilities[active.id] ?? { enabled: true }}
          args={args}
          busy={busy}
          stakeRange={stakeRange}
          forgeNote={forgeNote}
          sequenceLength={sequenceLength}
          armedAt={armedAt}
          onArg={(name, value) => setArgs((prev) => ({ ...prev, [name]: value }))}
          onRun={() => void send(active, args)}
        />

        {/*
          `loadCommand` is handed over as-is. It already does exactly what
          arming needs — select a command and fill its fields, running nothing —
          because that is what an accepted agent proposal does too. The rail's
          own select cannot be reused: it CLEARS args deliberately, since a
          stale field left over from the previous command is a wrong request.
        */}
        <FightersPane
          capabilities={capabilities}
          operator={operator}
          disabled={busy}
          sequenceLength={sequenceLength}
          onArm={loadCommand}
        />

        <ResponsePane envelope={envelope} />

        <ResponseLog rows={log} />

        <SeatState seat={seat} baseUrl={baseUrl} />

        <StandingPane standing={standing} />
      </div>

      {pending && (
        <ConfirmDialog
          request={pending.request}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const { cmd, args: confirmedArgs, confirm } = pending;
            setPending(null);
            void send(cmd, confirmedArgs, confirm);
          }}
        />
      )}
    </>
  );
}
