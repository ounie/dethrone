import "server-only";
import { randomUUID } from "node:crypto";
import type { Autonomy, AutonomyChallenge } from "../agent";
import { config } from "../config";
import { money } from "../format";
import { hasWallet } from "../wallet";

/**
 * The grant that lets the agent sign and pay without asking.
 *
 * ## It is held here, and nowhere the client can reach
 *
 * The mode is never a field on a request. That is the whole design, and the
 * reason is the same one `confirm-dialog.tsx` gives about the 428: anything the
 * browser can assert, anything that can POST can assert. So the grant lives in
 * this process, the route reads it, and the executor re-reads it on *every*
 * tool call rather than once per turn — a turn can run eight rounds over a
 * minute, and a revoke that only takes effect at the end of it is not a revoke.
 *
 * ## What the handshake is, and what it is not
 *
 * The console asks for a 428 naming terms it computed, the browser echoes them
 * back unchanged with a single-use nonce, and only then is a grant minted. That
 * is the identical shape as confirming a payment, and it buys the identical
 * thing: the mode cannot be turned on **by accident** — not by a stray form,
 * not by a request shaped like one, and not by a tool call the model itself
 * emits — and the terms are the server's rather than the caller's.
 *
 * It is **not authentication**, and must never be sold as such. This is a
 * single-tenant console on loopback with no login; anything that can POST once
 * can POST twice. The things that actually bound an agent are unchanged in both
 * modes and none of them is this: the loopback host check on every paid
 * command, the spend ceiling's reserve-and-release, the offer gate, and a
 * wallet that holds only what you meant to risk.
 *
 * ## Why there is no Redis implementation
 *
 * `spend.ts` has one because the ceiling has a serverless deployment to survive.
 * This does not: assertion 9 refuses to boot at all when full autonomy is set
 * alongside a key on serverless or with `CONSOLE_ALLOW_REMOTE`. So the only
 * configuration that can ever reach this file is a local one with a single
 * process, and a shared-store path here would be dead code implying a supported
 * shape that is in fact barred.
 */

export interface AutonomyGrant {
  perActionCapCents: number;
  grantedAtMs: number;
  expiresAtMs: number;
  operator: string;
}

export type GrantFailure = "nonce" | "acknowledgement" | "operator" | "unavailable";

export interface AutonomyStore {
  /** Whether a grant may be *offered* here. False carries a reason. */
  readonly offerable: boolean;
  readonly reason?: string;
  /** The live grant, or null when there is none or it has expired. */
  read(): AutonomyGrant | null;
  /** What the executor asks. Never derived from anything a caller sent. */
  mode(): Autonomy;
  challenge(capCents: number): AutonomyChallenge;
  grant(
    echo: { operator: string; acknowledgement: string; nonce: string },
    capCents: number,
  ): { ok: true; grant: AutonomyGrant } | { ok: false; reason: GrantFailure };
  revoke(): void;
}

/**
 * How long a grant lives.
 *
 * Long enough to be a sitting, short enough that walking away from the desk
 * ends it. It is not a session token and there is no refresh: when it lapses the
 * agent goes back to proposing, which is the safe direction to fail in.
 */
export const AUTONOMY_TTL_MS = 30 * 60 * 1000;

/** How long the browser has to echo a challenge back before it is worthless. */
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;

const GLOBAL_KEY = "__dethrone_console_autonomy__";

interface State {
  grant: AutonomyGrant | null;
  /** Nonces minted and not yet spent, with their expiry. */
  nonces: Map<string, number>;
}

function state(): State {
  const g = globalThis as unknown as Record<string, State | undefined>;
  return (g[GLOBAL_KEY] ??= { grant: null, nonces: new Map() });
}

/**
 * The sentence the operator confirms.
 *
 * Recomputed at verify time rather than remembered, which is the point: if the
 * ceiling is tightened between the browser reading this and echoing it back,
 * the strings differ and the grant is refused. The operator then reads the new
 * terms. A confirmation that survives the terms changing underneath it is a
 * confirmation of nothing.
 */
export function acknowledgementFor(
  operator: string,
  perActionCapCents: number,
  capCents: number,
): string {
  return (
    `I am letting an agent sign and pay from ${operator} without asking me first. ` +
    `No single action may exceed ${money(perActionCapCents)}, and this sitting may not exceed ${money(capCents)}.`
  );
}

function unavailable(reason: string): AutonomyStore {
  return {
    offerable: false,
    reason,
    read: () => null,
    mode: () => "reads",
    challenge() {
      throw new Error("autonomy is not offerable here");
    },
    grant: () => ({ ok: false, reason: "unavailable" }),
    revoke() {},
  };
}

function liveStore(operator: string, perActionCapCents: number): AutonomyStore {
  const read = (): AutonomyGrant | null => {
    const s = state();
    if (!s.grant) return null;
    if (Date.now() >= s.grant.expiresAtMs) {
      s.grant = null;
      return null;
    }
    return s.grant;
  };

  return {
    offerable: true,
    read,
    mode: () => (read() ? "full" : "reads"),

    challenge(capCents) {
      const s = state();
      const now = Date.now();
      // Sweep before minting, so a browser that opens and abandons the dialog
      // fifty times does not leave fifty live nonces behind.
      for (const [n, expiry] of s.nonces) if (expiry <= now) s.nonces.delete(n);

      const nonce = randomUUID();
      s.nonces.set(nonce, now + CHALLENGE_TTL_MS);

      return {
        operator,
        perActionCapCents,
        capCents,
        expiresInMs: AUTONOMY_TTL_MS,
        acknowledgement: acknowledgementFor(operator, perActionCapCents, capCents),
        nonce,
      };
    },

    grant(echo, capCents) {
      const s = state();
      const now = Date.now();

      const expiry = s.nonces.get(echo.nonce);
      if (expiry === undefined || expiry <= now) return { ok: false, reason: "nonce" };
      // Consumed whether or not the rest verifies. A nonce that survives a
      // failed attempt is a nonce that can be guessed at repeatedly.
      s.nonces.delete(echo.nonce);

      if (echo.operator !== operator) return { ok: false, reason: "operator" };
      if (echo.acknowledgement !== acknowledgementFor(operator, perActionCapCents, capCents)) {
        return { ok: false, reason: "acknowledgement" };
      }

      s.grant = {
        perActionCapCents,
        grantedAtMs: now,
        expiresAtMs: now + AUTONOMY_TTL_MS,
        operator,
      };
      return { ok: true, grant: s.grant };
    },

    revoke() {
      state().grant = null;
    },
  };
}

/**
 * Three ways to have nothing to offer, and each says which one it is.
 *
 * ## The ceiling clause is unreachable, and stays anyway
 *
 * Worth being exact, because a reader will otherwise assume it is what makes a
 * serverless deploy safe. It is not: **assertion 9 is.** The ceiling is only
 * ever disabled on serverless without a KV store, and assertion 9 refuses to
 * boot at all when full autonomy is set alongside a key there — so by the time
 * control reaches the third clause, `ceilingEnabled` is necessarily true.
 *
 * It stays because the invariant it states is the real one — *no ceiling, no
 * autonomy* — and because the thing keeping it unreachable is a condition in a
 * different file that a future edit could relax without noticing this. It is
 * belt to assertion 9's braces, and it is deliberately not tested as though it
 * were reachable; `test/autonomy.test.ts` says so.
 */
export function autonomyStore(operator: string | null): AutonomyStore {
  const cfg = config();

  if (!cfg.allowFullAutonomy) {
    return unavailable(
      "Full autonomy is not enabled on this deploy. Set CONSOLE_ALLOW_FULL_AUTONOMY=true in .env.local and restart — and read what it says there first.",
    );
  }
  if (!hasWallet() || !operator) {
    return unavailable(
      "Read-only: this deploy holds no key, so there is nothing for an agent to sign or spend with.",
    );
  }
  if (!cfg.ceilingEnabled) {
    return unavailable(
      cfg.ceilingDisabledReason ??
        "The ceiling cannot bound a sitting here, so nothing could bound an autonomous agent either.",
    );
  }

  return liveStore(operator, cfg.autonomyMaxCents);
}

/** Test seam. Never called in production. */
export function __resetAutonomy(): void {
  const g = globalThis as unknown as Record<string, State | undefined>;
  delete g[GLOBAL_KEY];
}
