import { NextResponse } from "next/server";
import { z } from "zod";
import * as arena from "@/lib/arena";
import {
  byId,
  isCallerPriced,
  pathSegments,
  type Command,
  type Field,
} from "@/lib/commands";
import { config, paidCommandsAllowedFrom } from "@/lib/config";
import { consoleError, type ConsoleErrorCode } from "@/lib/errors";
import { redact } from "@/lib/redact";
import { rules } from "@/lib/rules";
import { resolveScope, signedHeaders } from "@/lib/sign";
import { spendStore } from "@/lib/spend";
import { address, hasWallet } from "@/lib/wallet";

/**
 * The one execution path.
 *
 * Every button in the console resolves here. There is no second fetch to the
 * canon anywhere in the tree, and `test/one-fetch.test.ts` fails if one appears.
 *
 * ## There is no switch
 *
 * The route is driven entirely by the catalogue: it fills a path, attaches a
 * signature or a payment, and renders what came back. It contains no game
 * logic, reads no clock, and computes no price. A `switch (id)` here would be
 * the place where per-command rules accumulate, so there isn't one, and
 * `test/catalogue-drift.test.ts` asserts the properties a switch would have
 * protected instead.
 *
 * ## The order below is load-bearing
 *
 * Every refusal happens before anything leaves the process. A ceiling that
 * refuses after the request has gone is a receipt, not a seatbelt.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  id: z.string(),
  args: z.record(z.string(), z.string()).default({}),
  /**
   * Echoed back from the confirmation dialog. Both fields must match what the
   * server independently computed — an echo the client could have invented is
   * not a confirmation.
   */
  confirm: z
    .object({ amountCents: z.number(), payer: z.string() })
    .optional(),
  /**
   * A caller-supplied confirmation threshold, in cents. It can only ever
   * TIGHTEN the configured one — `Math.min`, never assignment, exactly like
   * the ceiling's `tighten`.
   *
   * ## Why this exists, and why it is safe to accept from a caller
   *
   * The agent has a per-action cap that is much lower than a human's
   * confirmation threshold, and it needs to know what the arena will charge
   * *before* anything settles. The only place this route reveals a price is the
   * 428 — so a paid command below `CONSOLE_CONFIRM_OVER_CENTS` used to execute
   * without the executor ever seeing the amount, and the per-action cap was
   * never consulted. That was a real hole, found by running it.
   *
   * Accepting a number from the caller looks like the thing this file refuses
   * to do everywhere else, so the distinction matters: this cannot be used to
   * skip a confirmation, only to demand one that would not otherwise happen.
   * The worst a hostile value can do is make the route ask a question. A
   * request cannot raise the threshold, and cannot reach the value the operator
   * configured.
   */
  confirmOverCents: z.number().int().nonnegative().optional(),
});

function fail(code: ConsoleErrorCode, detail?: Record<string, unknown>): NextResponse {
  const { status, body } = consoleError(code, detail);
  return NextResponse.json(body, { status });
}

/** Query params for GET, JSON body for everything else. */
function isQueryField(cmd: Command, field: Field): boolean {
  return cmd.method === "GET" && !cmd.path.includes(`:${field.name}`);
}

export async function POST(req: Request): Promise<NextResponse> {
  let cfg;
  try {
    cfg = config();
  } catch (err) {
    return fail("CONSOLE_MISCONFIGURED", {
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("CONSOLE_UNKNOWN_COMMAND", { reason: "malformed request" });

  const { id, args, confirm } = parsed.data;
  // min(), not assignment. The line that makes the override one-way.
  const confirmOver = Math.min(cfg.confirmOverCents, parsed.data.confirmOverCents ?? Infinity);
  const cmd = byId(id);
  if (!cmd) return fail("CONSOLE_UNKNOWN_COMMAND", { id });

  // ── Registration gates ────────────────────────────────────────────────────
  if (cmd.requiresOptIn && !cfg.allowGenesis) {
    return fail("CONSOLE_COMMAND_DISABLED", { id, requires: cmd.requiresOptIn });
  }

  const paid = cmd.tier === "paid";
  const signed = cmd.tier === "signed";

  if ((paid || signed) && !hasWallet()) return fail("CONSOLE_NO_WALLET", { id });

  if (paid) {
    // The interface pin. Fails closed on money, open on reads.
    const live = await rules();
    if (!live.interfaceMatches) {
      return fail("CONSOLE_INTERFACE_MISMATCH", {
        expected: "interface-v2",
        got: live.interfaceVersion,
      });
    }

    // Assertion 3's request half — the host on THIS request, not the one the
    // process was started with.
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!paidCommandsAllowedFrom(host)) {
      return fail("CONSOLE_REMOTE_HOST", { host });
    }
  }

  // ── Fill the path and the body ────────────────────────────────────────────
  //
  // Each `:segment` is encoded individually. The console makes no request when
  // a required segment is empty.
  let path = cmd.path;
  const body: Record<string, unknown> = {};
  const query: Record<string, string> = {};
  const rawArgs: Record<string, string> = {};

  for (const field of cmd.fields ?? []) {
    let value = (args[field.name] ?? "").trim();

    // The one default the console supplies, because it is not a rule: the
    // operator's own address, which the browser already knows.
    if (!value && field.name === "address") value = address() ?? "";

    rawArgs[field.name] = value;

    if (path.includes(`:${field.name}`)) {
      if (!value && !field.optional) return fail("CONSOLE_MISSING_FIELD", { field: field.name });
      path = path.replace(`:${field.name}`, encodeURIComponent(value));
      continue;
    }

    if (!value) {
      if (!field.optional && !paid) return fail("CONSOLE_MISSING_FIELD", { field: field.name });
      continue;
    }

    if (isQueryField(cmd, field)) {
      query[field.name] = value;
      continue;
    }

    if (field.kind === "actions") {
      // A sequence of menu indices. It arrives as JSON because every arg on the
      // wire is a string, and it is validated to a homogeneous integer array
      // here so a malformed pick is a local refusal rather than a 400 from the
      // arena. The LENGTH and the upper bound are deliberately not checked:
      // both are the canon's rules, and re-stating them here would be a second
      // implementation that can disagree.
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        return fail("CONSOLE_BAD_FIELD", { field: field.name, value });
      }
      if (!Array.isArray(parsed) || !parsed.every((n) => Number.isInteger(n))) {
        return fail("CONSOLE_BAD_FIELD", { field: field.name, value });
      }
      body[field.name] = parsed;
    } else if (field.kind === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) return fail("CONSOLE_BAD_FIELD", { field: field.name, value });
      body[field.name] = n;
    } else if (field.kind === "boolean") {
      body[field.name] = value === "true";
    } else {
      body[field.name] = value;
    }
  }

  // A `:segment` with no matching field is a catalogue bug, not an operator
  // error. Refuse rather than send a literal ":id" to the canon.
  const unresolved = pathSegments(path);
  if (unresolved.length > 0) return fail("CONSOLE_MISSING_FIELD", { field: unresolved[0] });

  // ── Cost, confirmation, ceiling ───────────────────────────────────────────
  const operator = address();
  let cost = 0;
  let maxCents: number | null = null;

  if (paid) {
    if (isCallerPriced(cmd)) {
      const source = cmd.amountField ?? "maxCents";
      const raw = (args[source] ?? "").trim();
      const n = Number(raw);
      if (!raw || !Number.isFinite(n) || n <= 0) {
        return fail("CONSOLE_BAD_FIELD", { field: source, value: raw });
      }
      cost = Math.ceil(n);
      // For a listing-priced command the operator's number is a *ceiling on the
      // quote*, not the price. The offer gate enforces it before signing.
      maxCents = cmd.maxField ? cost : null;
    } else {
      // The live number where the canon publishes one; the catalogue's hint
      // otherwise. Either way this is only what the ceiling checks — the amount
      // actually settled comes from the 402.
      const live = await rules();
      cost = (cmd.livePrice ? live.money[cmd.livePrice] : undefined) ?? cmd.cents;
    }

    // Confirmation is enforced HERE, not in the browser. A dialog in a client
    // component is bypassable by anything that can POST to this route, and it
    // is not a thing a test can assert. Above the threshold, or caller-priced
    // at any amount, this route refuses until the operator's echo matches what
    // the server independently computed.
    const needsConfirm = isCallerPriced(cmd) || cost > confirmOver;
    if (needsConfirm && (confirm?.amountCents !== cost || confirm?.payer !== operator)) {
      return fail("CONSOLE_CONFIRM_REQUIRED", {
        amountCents: cost,
        payer: operator,
        callerPriced: isCallerPriced(cmd),
      });
    }
  }

  // A destructive command moves no money, so the confirmation names no amount —
  // it names what is destroyed and who signs. The echo check is on the payer
  // alone, which is the only thing there is to agree about.
  if (cmd.destructive && confirm?.payer !== operator) {
    return fail("CONSOLE_CONFIRM_REQUIRED", { payer: operator, destructive: true });
  }

  const store = spendStore(operator);
  let reserved = false;

  if (paid && store.enabled) {
    const reservation = await store.reserve(cost);
    if (!reservation.ok) {
      return fail("CONSOLE_SPEND_CAP", {
        spentCents: reservation.spentCents,
        cap: reservation.cap,
        wouldSpend: reservation.wouldSpend,
      });
    }
    reserved = true;
    // The ceiling also bounds the quote: never sign for more than what remains.
    const remaining = reservation.cap - (reservation.spentCents - cost);
    maxCents = maxCents === null ? remaining : Math.min(maxCents, remaining);
  }

  // ── Signature ─────────────────────────────────────────────────────────────
  const headers: Record<string, string> = {};
  if (signed && cmd.signScope) {
    Object.assign(
      headers,
      await signedHeaders(resolveScope(cmd.signScope, rawArgs), cmd.method, path),
    );
  }

  // ── The request ───────────────────────────────────────────────────────────
  const request: arena.ArenaRequest = {
    method: cmd.method,
    path,
    query: Object.keys(query).length ? query : undefined,
    body: cmd.method !== "GET" && Object.keys(body).length ? body : undefined,
    headers,
    paid,
    maxCents,
  };

  let outcome = await arena.call(request);

  // The single permitted retry: the transport died with no status ever
  // received, and a payload had already been signed. Resend that exact payload
  // once. Never re-sign — a fresh signature is a second payment.
  if (!outcome.result && outcome.attempt.capturedSignature) {
    outcome = await arena.replay(request, outcome.attempt.capturedSignature);
    if (!outcome.result) {
      if (reserved) await store.release(cost);
      return fail("CONSOLE_PAYMENT_INFLIGHT", { path, hint: "Re-read the canon before acting." });
    }
  }

  if (!outcome.result) {
    if (reserved) await store.release(cost);
    if (outcome.attempt.refusedOffer) {
      return fail("CONSOLE_PRICE_ABOVE_MAX", outcome.attempt.refusedOffer);
    }
    return fail("CONSOLE_TRANSPORT", {
      reason: outcome.transportError?.message ?? "unknown",
    });
  }

  const result = outcome.result;

  // The offer gate fired: the arena quoted more than the operator allowed and
  // nothing was signed. This is a refusal, not a failed payment.
  if (outcome.attempt.refusedOffer) {
    if (reserved) await store.release(cost);
    return fail("CONSOLE_PRICE_ABOVE_MAX", outcome.attempt.refusedOffer);
  }

  // x402 settles on handler success, so a refusal costs nothing. Releasing here
  // is what keeps the observed `spentCents` from ever rising on a non-2xx —
  // counting a 409 would make the seatbelt tighten on refusals, which is
  // precisely backwards.
  if (reserved && !result.ok) await store.release(cost);

  const ledger = await store.read();

  return NextResponse.json(
    redact(
      {
        request: {
          method: cmd.method,
          path,
          paid,
          signed,
          scope: signed && cmd.signScope ? resolveScope(cmd.signScope, rawArgs) : null,
        },
        status: result.status,
        ms: result.ms,
        interface: {
          expected: "interface-v2",
          got: result.interfaceVersion,
          match: arena.interfaceMatches(result.interfaceVersion),
        },
        featureDisabled: result.featureDisabled,
        // Not `paid && ok`. A settlement the arena did not report did not
        // happen — under the dev bypass nothing settles at all, and saying
        // otherwise would be a lie on a money screen.
        settled: paid && result.ok && result.settlement?.success === true,
        settlement: result.settlement,
        ceiling: store.enabled
          ? { enabled: true, spentCents: ledger?.spentCents ?? 0, cap: ledger?.cap ?? cfg.maxSpendCents }
          : { enabled: false, reason: store.reason },
        body: result.body,
      },
      [process.env.DETHRONE_PRIVATE_KEY ?? ""],
    ),
    { status: 200 },
  );
}
