import "server-only";
import { config } from "./config";

/**
 * The spend ceiling for one sitting.
 *
 * ## Reserve, then release — not count-after-success
 *
 * The PRD says `spentCents` increments only on `res.ok`, because x402 settles
 * on handler success and a 409 costs nothing. That property is preserved
 * exactly: what an operator *observes* never rises on a non-2xx.
 *
 * But implementing it literally — check the ceiling, await the request,
 * increment if it worked — leaves a window across the `await` in which two
 * concurrent clicks both pass a check that only one of them should. So the
 * amount is **reserved before the request and released if it did not settle**.
 * Same observable behaviour, no window, and it is the only shape that works at
 * all when two invocations share a store instead of a process.
 *
 * ## The ceiling is not a guarantee
 *
 * It lives in this app's own process and protects against a stray click, not
 * against a compromised host. It is not escrow. Where it cannot do even that —
 * serverless with no shared store — it reports itself **disabled** rather than
 * rendering a number that resets unpredictably.
 */

export interface Reservation {
  ok: boolean;
  spentCents: number;
  cap: number;
  wouldSpend: number;
}

export interface SpendStore {
  readonly enabled: boolean;
  readonly reason?: string;
  reserve(cents: number): Promise<Reservation>;
  release(cents: number): Promise<void>;
  read(): Promise<{ spentCents: number; cap: number } | null>;
}

/**
 * The in-process counter. The default, and the correct one for a local run.
 *
 * Held on `globalThis` so a hot reload does not reset the ceiling mid-sitting —
 * a seatbelt that unbuckles every time you save a file is not a seatbelt.
 */
const GLOBAL_KEY = "__dethrone_console_spent__";

function memoryCounter(): { value: number } {
  const g = globalThis as unknown as Record<string, { value: number } | undefined>;
  return (g[GLOBAL_KEY] ??= { value: 0 });
}

function memoryStore(cap: number): SpendStore {
  return {
    enabled: true,
    async reserve(cents) {
      const counter = memoryCounter();
      const next = counter.value + cents;
      if (next > cap) {
        return { ok: false, spentCents: counter.value, cap, wouldSpend: cents };
      }
      counter.value = next;
      return { ok: true, spentCents: counter.value, cap, wouldSpend: cents };
    },
    async release(cents) {
      const counter = memoryCounter();
      counter.value = Math.max(0, counter.value - cents);
    },
    async read() {
      return { spentCents: memoryCounter().value, cap };
    },
  };
}

/**
 * Upstash Redis over REST.
 *
 * REST and not a `redis://` TCP client on purpose: serverless opens a
 * connection per invocation, and a pool that never gets reused is how a
 * ceiling becomes an outage. `INCRBY` is atomic, so this is the only
 * implementation where the ceiling genuinely holds across isolates.
 *
 * Keyed by the operator address, TTL'd to a rolling 24h window. Wiping the
 * store loses a session counter and nothing else — it is a cache, not a
 * credential vault, and there is no participant token to keep in it.
 */
function redisStore(
  cap: number,
  kv: { url: string; token: string },
  key: string,
): SpendStore {
  const call = async (command: unknown[]): Promise<unknown> => {
    const res = await fetch(kv.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${kv.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`KV ${res.status}`);
    const json = (await res.json()) as { result?: unknown };
    return json.result;
  };

  return {
    enabled: true,
    async reserve(cents) {
      const next = Number(await call(["INCRBY", key, String(cents)]));
      // First write in the window starts the clock. EXPIRE is a no-op on a key
      // that already has a TTL only if we ask for NX, which not every server
      // supports — so set it whenever the counter equals the reservation, which
      // is exactly the first write.
      if (next === cents) await call(["EXPIRE", key, "86400"]);
      if (next > cap) {
        await call(["DECRBY", key, String(cents)]);
        return { ok: false, spentCents: Math.max(0, next - cents), cap, wouldSpend: cents };
      }
      return { ok: true, spentCents: next, cap, wouldSpend: cents };
    },
    async release(cents) {
      await call(["DECRBY", key, String(cents)]);
    },
    async read() {
      const raw = await call(["GET", key]);
      return { spentCents: Number(raw ?? 0), cap };
    },
  };
}

/**
 * The honest no-op. Announces itself; never pretends to a number.
 *
 * This is the PRD's third resolution, chosen deliberately over silently keeping
 * a counter that resets between two clicks. Every refusal it *would* have made
 * is now the operator's to make, and the screen says so rather than implying a
 * protection that is not there.
 */
function disabledStore(reason: string): SpendStore {
  return {
    enabled: false,
    reason,
    async reserve(cents) {
      return { ok: true, spentCents: 0, cap: 0, wouldSpend: cents };
    },
    async release() {},
    async read() {
      return null;
    },
  };
}

export function spendStore(operator: string | null): SpendStore {
  const cfg = config();
  if (cfg.kv) {
    return redisStore(cfg.maxSpendCents, cfg.kv, `console:spend:${(operator ?? "anon").toLowerCase()}`);
  }
  if (!cfg.ceilingEnabled) {
    return disabledStore(cfg.ceilingDisabledReason ?? "The ceiling cannot bound a sitting here.");
  }
  return memoryStore(cfg.maxSpendCents);
}
