"use client";

import { useCallback, useState } from "react";
import ChatPane from "./chat-pane";
import ConsoleLayout from "./console-layout";
import CommandPane from "./command-pane";
import ConfirmDialog, { type ConfirmRequest } from "./confirm-dialog";
import FightersPane from "./fighters-pane";
import MatchPane from "./match-pane";
import Masthead, { type Ceiling, type House, type Wallet } from "./masthead";
import Rail from "./rail";
import ResponseLog, { type LogRow } from "./response-log";
import ResponsePane from "./response-pane";
import SeatState, { type SeatSnapshot } from "./seat-state";
import StandingPane from "./standing-pane";
import type { AgentConfig, ChatEventWire } from "@/lib/agent";
import type { ArenaChoice, Capabilities, StakeRange } from "@/lib/capability";
import type { Standing } from "@/lib/standing";
import type { Envelope } from "@/lib/envelope";
import { byId, COMMANDS, type Command } from "@/lib/commands";
import type { PatronTierOption } from "@/lib/patronage";
import { logTime } from "@/lib/format";
import { revealResultPane } from "@/lib/reveal";

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

/**
 * The fields a freshly chosen command starts with.
 *
 * Exactly one default, and only when the command asks for a character id and
 * the Fighters panel has one open. Everything else starts empty, because
 * everything else is either a game input or somebody else's id.
 *
 * Not applied to an exhibition's `fighterA` / `fighterB`: a promoter books two
 * fighters and neither is obviously "yours", so guessing one would fill a field
 * the operator has to check anyway.
 */
function seedArgs(cmd: Command, fighter: number | null): Record<string, string> {
  if (fighter === null) return {};
  const wantsCharacter = (cmd.fields ?? []).some((f) => f.name === "characterId");
  return wantsCharacter ? { characterId: String(fighter) } : {};
}

export default function Console({
  operator,
  baseUrl,
  capabilities,
  agent,
  forgeNote,
  stakeRange,
  patronTiers,
  arenas,
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
  patronTiers: readonly PatronTierOption[];
  /** Every arena the canon publishes, for the fields that name one. */
  arenas: readonly ArenaChoice[];
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
  /*
    A fighter this console just forged, handed to the Fighters panel to watch.

    A forge answers 202 with a character that is still `forging` — the row
    exists, the genome is decided, the portrait is not rendered yet. Until now
    the panel had no way to learn that, so a successful forge left "No fighters"
    on screen beside a response body naming the character it had just paid for.

    A counter rides along with the id so forging the same character twice — the
    arena returns the one you already have, at no charge — still re-triggers the
    watch. An id alone would compare equal and do nothing.
  */
  const [forged, setForged] = useState<{ characterId: number; nonce: number } | null>(null);
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

      /*
        Read off the RESPONSE, not off the command that was run.

        The console does not decide that a forge happened; the arena says so, by
        answering with a character id. That keeps this a rendering rather than
        an inference — an envelope with no character is simply not a forge to
        watch, whatever was pressed.
      */
      const forgedId = (data.body as { characterId?: unknown } | undefined)?.characterId;
      if (typeof forgedId === "number") {
        setForged((prev) => ({ characterId: forgedId, nonce: (prev?.nonce ?? 0) + 1 }));
      }

      /*
        A SETTLED command puts its result in another card, so go there.

        Gated on `settled`, which is the receipt the payment produced rather
        than anything this client inferred — so a free read that happens to
        answer with a match id moves the page nowhere, and neither does a
        refusal. Reads are how an operator browses, and a browse that hijacks
        the scroll is the feature becoming an annoyance; an error belongs on
        screen under the button that caused it, not scrolled away from.

        Which card is `revealResultPane`'s call, off the same two fields the
        forge watch above reads and under the same law.
      */
      if (data.settled && !data.error) revealResultPane(data.body);
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

  /*
    The fighter the Fighters panel has open, so a command chosen from the RAIL
    can start with it filled in.

    That panel opens on the PRIME — one per wallet, forever, the fighter the
    wallet's own address derives to — so "the selected fighter, or the prime" is
    one value rather than two: the prime IS the selection until somebody picks
    another.

    A DEFAULT, never a decision. `/api/act` supplies exactly one of these today
    and states the rule: the operator's own address, "because it is not a rule".
    A character id this wallet owns is the same kind of fact. The field stays
    editable, an armed command still overrides it, and nothing is sent until Run.
  */
  const [openFighter, setOpenFighter] = useState<number | null>(null);

  /*
    Which match the Match card opens, and the precedence is deliberate.

    The seat's live match is the standing answer — it is what is happening now,
    and a console that had to be told about it would be asking the operator for
    something it already knows. A match the operator just READ outranks it,
    because running a match read is asking for that match by name.

    Read off the envelope rather than tracked separately, for the reason the
    forge watch beside it gives: an envelope with no matchId is simply not a
    match, and inferring one would be the panel deciding what the operator meant.
  */
  const readMatchId = (envelope?.body as { matchId?: unknown } | undefined)?.matchId ?? null;
  const openMatchId =
    (typeof readMatchId === "string" && readMatchId) || seat.liveMatchId || null;


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

      <ConsoleLayout
        rail={
          <Rail
            capabilities={capabilities}
            activeId={active.id}
            onSelect={(cmd) => {
              setActive(cmd);
              // Cleared deliberately — a stale field left over from the
              // previous command is a wrong request — and then seeded with the
              // one default this console supplies.
              setArgs(seedArgs(cmd, openFighter));
            }}
          />
        }
        panes={{
          chat: (drag) => (
            <ChatPane
              drag={drag}
              agent={agent}
              capabilities={capabilities}
              busy={busy}
              onBusy={setBusy}
              onLoadCommand={loadCommand}
              onRunCommand={runCommand}
              onEnvelope={onAgentEvent}
            />
          ),
          command: (drag) => (
            <CommandPane
              drag={drag}
              cmd={active}
              capability={capabilities[active.id] ?? { enabled: true }}
              args={args}
              busy={busy}
              stakeRange={stakeRange}
              arenas={arenas}
              patronTiers={patronTiers}
              forgeNote={forgeNote}
              sequenceLength={sequenceLength}
              armedAt={armedAt}
              onArg={(name, value) => setArgs((prev) => ({ ...prev, [name]: value }))}
              onRun={() => void send(active, args)}
            />
          ),
          /*
            `loadCommand` is handed over as-is. It already does exactly what
            arming needs — select a command and fill its fields, running nothing
            — because that is what an accepted agent proposal does too. The
            rail's own select cannot be reused: it CLEARS args deliberately,
            since a stale field left over from the previous command is a wrong
            request.
          */
          fighters: (drag) => (
            <FightersPane
              drag={drag}
              capabilities={capabilities}
              operator={operator}
              disabled={busy}
              sequenceLength={sequenceLength}
              onArm={loadCommand}
              onSelectedFighter={setOpenFighter}
              forged={forged}
            />
          ),
          /*
            The match to open, from what the console already knows. The seat's
            live match is the standing answer; a match id the operator just read
            wins over it, because running one is asking for it.
          */
          match: (drag) => (
            <MatchPane
              matchId={openMatchId}
              operator={operator}
              drag={drag}
              disabled={busy}
            />
          ),
          response: (drag) => <ResponsePane envelope={envelope} drag={drag} />,
          log: (drag) => <ResponseLog rows={log} drag={drag} />,
          seat: (drag) => <SeatState seat={seat} baseUrl={baseUrl} drag={drag} />,
          standing: (drag) => <StandingPane standing={standing} drag={drag} />,
        }}
      />

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
