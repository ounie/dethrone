import "server-only";
import type { Autonomy } from "../agent";
import type { Capabilities } from "../capability";
import { consoleError, type ConsoleErrorCode } from "../errors";
import { redact } from "../redact";
import { callAct } from "./act-bridge";
import type { AutonomyStore } from "./autonomy";
import { commandForTool } from "./tools";
import {
  MAX_TOOL_RESULT_BYTES,
  type ChatEvent,
  type ToolCall,
  type ToolExecutor,
  type ToolOutcome,
  type ToolResult,
} from "./types";

/**
 * The gate between what a model intends and what this console does.
 *
 * Every provider adapter is handed the same closure from here. That is the
 * design: an adapter cannot skip a guard by being written differently from its
 * siblings, because an adapter has no other way to have an effect at all.
 *
 * ## The order below is load-bearing
 *
 * Same claim `/api/act` makes about itself, for the same reason — every refusal
 * happens before anything leaves the process:
 *
 *   1. unknown tool          → refuse locally, never call act
 *   2. arguments coerce      → refuse locally, never call act
 *   3. tier gate             → PROPOSE, and return without calling act
 *   4. destructive           → PROPOSE, in every mode, always
 *   5. grant re-read         → refuse locally, never call act
 *   6. call act, unconfirmed
 *   7. one confirmation echo, with the cap checked BETWEEN the two calls
 *   8. redact again, then hand it to a third party
 *
 * ## Three things this deliberately does not do
 *
 * **It does not compute an amount.** Step 7 reads `amountCents` and `payer` out
 * of the 428 that `/api/act` itself produced and echoes them back unchanged. The
 * agent never names a price, and neither does this file. That is the same
 * contract the browser has, and it is why "the model decided to spend more" is
 * not a reachable state.
 *
 * **It does not loop.** Step 7 happens exactly once. The shape is one keystroke
 * from `while (status === 428)`, and that loop is a double-spend generator the
 * moment act returns a 428 for a reason the retry does not fix.
 *
 * **It does not cache the mode.** Step 5 asks the store on *every* call, not
 * once per turn. A turn can run eight rounds across a minute; a revoke that
 * only takes effect when the turn ends is not a revoke.
 */

export interface ExecutionContext {
  /** The request the turn arrived on. Its Host header is what act will check. */
  origin: Request;
  capabilities: Capabilities;
  autonomy: AutonomyStore;
  /** Redacted out of every tool result, on top of what act already removed. */
  secrets: readonly string[];
}

/** A tool result the model reads, paired with the event the operator sees. */
function refuse(
  call: ToolCall,
  code: ConsoleErrorCode,
  detail?: string,
): ToolOutcome {
  const { body } = consoleError(code);
  return {
    toolResult: {
      id: call.id,
      name: call.name,
      content: JSON.stringify({ refused: code, message: body.error.message, detail }),
      isError: true,
    },
    event: { type: "refused", tool: call.name, code, detail },
  };
}

/**
 * Every argument reaches `/api/act` as a string, because its body schema is
 * `z.record(z.string(), z.string())`. Models send JSON, so numbers, booleans and
 * arrays all arrive typed and are flattened here — an array to JSON, which is
 * exactly what the `actions` field expects to parse back.
 *
 * An object is refused rather than stringified: there is no field on any command
 * that takes one, so an object means the model has misunderstood the schema, and
 * a silent `[object Object]` would surface as a puzzling refusal from the arena
 * instead of a clear one from here.
 */
function coerceArgs(
  raw: Record<string, unknown>,
): { ok: true; args: Record<string, string> } | { ok: false; field: string } {
  const args: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string") args[name] = value;
    else if (typeof value === "number" || typeof value === "boolean") args[name] = String(value);
    else if (Array.isArray(value)) args[name] = JSON.stringify(value);
    else return { ok: false, field: name };
  }
  return { ok: true, args };
}

/** A tool result is an egress to a third party. Bound it, and say when you did. */
function capped(serialised: string): string {
  if (serialised.length <= MAX_TOOL_RESULT_BYTES) return serialised;
  // Announced, not silent. A model that cannot tell it received half an answer
  // will report confidently on the half it received.
  return (
    serialised.slice(0, MAX_TOOL_RESULT_BYTES) +
    `\n\n[truncated by the console at ${MAX_TOOL_RESULT_BYTES} characters — ask for a narrower read]`
  );
}

interface ActEnvelope {
  request?: { method?: string; path?: string };
  status?: number;
  ms?: number | null;
  settled?: boolean;
  body?: unknown;
  error?: { code?: string; message?: string; detail?: Record<string, unknown> };
}

export function makeExecutor(ctx: ExecutionContext): ToolExecutor {
  const secrets = ctx.secrets.filter((s) => s.length >= 8);

  const finish = (
    call: ToolCall,
    commandId: string,
    method: string,
    args: Record<string, string>,
    res: { status: number; body: Record<string, unknown> },
    terms?: { amountCents: number; payer: string },
  ): ToolOutcome => {
    // The second redaction. `/api/act` already redacted this envelope on its way
    // to the browser, with the wallet key as the secret. This pass runs with the
    // PROVIDER keys as secrets, because the destination is different: a tool
    // result is sent to a third-party model host, which is an egress act was
    // never written to think about.
    const clean = redact(res.body, secrets) as ActEnvelope;

    const event: ChatEvent = {
      type: "executed",
      tool: call.name,
      commandId,
      method,
      path: clean.request?.path ?? "",
      args,
      status: clean.status ?? clean.error?.code ?? res.status,
      ms: clean.ms ?? null,
      settled: clean.settled === true,
      ...(clean.error?.code ? { errorCode: clean.error.code } : {}),
      ...(terms ? { terms } : {}),
      // Uncapped, for the browser. The model gets the capped copy below.
      body: clean,
    };

    return {
      toolResult: {
        id: call.id,
        name: call.name,
        content: capped(JSON.stringify(clean)),
        isError: typeof clean.status === "number" ? clean.status >= 400 : !!clean.error,
      },
      event,
    };
  };

  return async function execute(call: ToolCall): Promise<ToolOutcome> {
    // ── 1. Is this even a command ────────────────────────────────────────────
    const cmd = commandForTool(call.name);
    if (!cmd) return refuse(call, "CONSOLE_UNKNOWN_COMMAND", call.name);

    // A tool for a command this deploy cannot run should never have been
    // offered. If one is called anyway, the deploy's own reason is the answer.
    const capability = ctx.capabilities[cmd.id];
    if (capability && !capability.enabled) {
      return refuse(call, "CONSOLE_COMMAND_DISABLED", capability.reason);
    }

    // ── 2. Do the arguments make it onto the wire ────────────────────────────
    const coerced = coerceArgs(call.args ?? {});
    if (!coerced.ok) return refuse(call, "CONSOLE_BAD_FIELD", coerced.field);
    const args = coerced.args;

    const propose = (why: string): ToolOutcome => ({
      toolResult: {
        id: call.id,
        name: call.name,
        content: JSON.stringify({
          proposed: cmd.id,
          args,
          note:
            "Nothing was sent. This is now in front of the operator, who will run it or not." +
            " Do not call this tool again for the same action; say what you proposed and why.",
        }),
      },
      event: { type: "proposal", tool: call.name, commandId: cmd.id, args, why },
    });

    // ── 3 & 4. The tier gate, and the one exception that outranks the mode ───
    //
    // Destructive first, because it is unconditional: `release` moves no money,
    // so neither the ceiling nor the per-action cap can bound it, and a cap that
    // cannot bound a thing must not be treated as permission for it.
    if (cmd.destructive) {
      return propose("Destructive and irreversible. This is the operator's click in any mode.");
    }

    if (cmd.tier !== "free") {
      // ── 5. What the mode actually is, asked now, not remembered ───────────
      const mode: Autonomy = ctx.autonomy.mode();
      if (mode !== "full") {
        return propose(
          cmd.tier === "paid"
            ? "Spends USDC. The operator confirms the amount the arena names."
            : "Signs with the operator's wallet.",
        );
      }
    }

    // ── 6. The unconfirmed call ─────────────────────────────────────────────
    //
    // `confirmOverCents: 0` forces a 428 for ANY paid command, so the executor
    // always learns the arena's price before anything settles.
    //
    // This line is a bug fix, and the bug is worth recording because it was
    // invisible in every test and obvious the moment it ran. The per-action cap
    // used to be checked only inside the 428 branch — but the route only 428s
    // above `CONSOLE_CONFIRM_OVER_CENTS`, which a human sets at a human's
    // threshold. A paid command cheaper than that executed without the executor
    // ever seeing an amount, so the cap was silently not a cap for exactly the
    // commands most likely to be run. It survived a full test suite because
    // every fixture set the two numbers close together.
    //
    // Tightening the threshold is safe to ask for and impossible to abuse: the
    // route takes the minimum, so the worst this can do is make it ask.
    const first = await callAct(ctx.origin, {
      id: cmd.id,
      args,
      ...(cmd.tier === "paid" ? { confirmOverCents: 0 } : {}),
    });

    if (first.status !== 428) {
      return finish(call, cmd.id, cmd.method, args, first);
    }

    // ── 7. Exactly one confirmation, on the server's own numbers ────────────
    const detail = (first.body as ActEnvelope).error?.detail as
      | { amountCents?: number; payer?: string }
      | undefined;
    const amountCents = detail?.amountCents;
    const payer = detail?.payer;

    if (typeof amountCents !== "number" || typeof payer !== "string") {
      // A 428 that names no terms is one this code does not know how to answer,
      // and inventing an answer is precisely the failure mode being avoided.
      return refuse(call, "CONSOLE_CONFIRM_REQUIRED", "the refusal named no terms to echo");
    }

    // The cap is checked HERE — between the two calls — so an over-cap command
    // is refused with nothing signed, rather than confirmed and then regretted.
    const grant = ctx.autonomy.read();
    if (!grant) return refuse(call, "CONSOLE_AUTONOMY_REQUIRED");
    if (amountCents > grant.perActionCapCents) {
      return refuse(
        call,
        "CONSOLE_AUTONOMY_LIMIT",
        `the arena priced this at ${amountCents} against a per-action cap of ${grant.perActionCapCents}`,
      );
    }

    const second = await callAct(ctx.origin, {
      id: cmd.id,
      args,
      confirmOverCents: 0,
      // Echoed, not recomputed. There is no arithmetic on this line by design.
      confirm: { amountCents, payer },
    });

    return finish(call, cmd.id, cmd.method, args, second, { amountCents, payer });
  };
}

/** Exported for the pin test: a tool result must never carry a raw envelope. */
export type { ToolResult };
