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
 * concurrent clicks both pass a check only one of them should. So the amount is
 * **reserved before the request and released if it did not settle**. Same
 * observable behaviour, no window, and it is the only shape that works at all
 * when two invocations share a store instead of a process.
 *
 * ## The cap can be tightened here, and never loosened
 *
 * `CONSOLE_MAX_SPEND_CENTS` sets the ceiling for a sitting, and the console can
 * lower it further from the UI. It can never raise it: a seatbelt you can
 * loosen at the moment it stops you is not a seatbelt, and the failure mode is
 * specific — you hit the cap, you are annoyed, you click "raise", you spend.
 * Loosening stays where it belongs, in `.env.local` behind a restart, because
 * that is an act you have to mean.
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

export interface Tightened {
  cap: number;
  changed: boolean;
}

export interface SpendStore {
  readonly enabled: boolean;
  readonly reason?: string;
  /** The ceiling now in force: the configured cap, or lower if tightened. */
  cap(): Promise<number>;
  reserve(cents: number): Promise<Reservation>;
  release(cents: number): Promise<void>;
  read(): Promise<{ spentCents: number; cap: number } | null>;
  /** Lower the ceiling for this sitting. A request to raise it is ignored. */
  tighten(cents: number): Promise<Tightened>;
}

/**
 * The in-process counter. The default, and the correct one for a local run.
 *
 * Held on `globalThis` so a hot reload does not reset the ceiling mid-sitting —
 * a seatbelt that unbuckles every time you save a file is not a seatbelt.
 */
const GLOBAL_KEY = "__dethrone_console_spent__";

interface Session {
  spent: number;
  /** Session-tightened cap, or null while the configured one stands. */
  cap: number | null;
}

function session(): Session {
  const g = globalThis as unknown as Record<string, Session | undefined>;
  return (g[GLOBAL_KEY] ??= { spent: 0, cap: null });
}

function memoryStore(configured: number): SpendStore {
  const effective = () => Math.min(configured, session().cap ?? configured);

  return {
    enabled: true,
    async cap() {
      return effective();
    },
    async reserve(cents) {
      const s = session();
      const cap = effective();
      const next = s.spent + cents;
      if (next > cap) {
        return { ok: false, spentCents: s.spent, cap, wouldSpend: cents };
      }
      s.spent = next;
      return { ok: true, spentCents: s.spent, cap, wouldSpend: cents };
    },
    async release(cents) {
      const s = session();
      s.spent = Math.max(0, s.spent - cents);
    },
    async read() {
      return { spentCents: session().spent, cap: effective() };
    },
    async tighten(cents) {
      const s = session();
      const current = effective();
      // min(), not assignment. This is the line that makes the control
      // one-way: a larger number changes nothing.
      const next = Math.min(current, cents);
      s.cap = next;
      return { cap: next, changed: next < current };
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
 * Two TTL'd keys for the sitting, both a rolling 24h window. Wiping the store
 * loses a session counter and a tightening, and nothing else — it is a cache,
 * not a credential vault, and there is no participant token to keep in it.
 */
function redisStore(configured: number, kv: { url: string; token: string }, key: string): SpendStore {
  const spentKey = `${key}:spent`;
  const capKey = `${key}:cap`;

  const call = async (command: unknown[]): Promise<unknown> => {
    const res = await fetch(kv.url, {
      method: "POST",
      headers: { authorization: `Bearer ${kv.token}`, "content-type": "application/json" },
      body: JSON.stringify(command),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`KV ${res.status}`);
    return ((await res.json()) as { result?: unknown }).result;
  };

  const effective = async (): Promise<number> => {
    const stored = Number(await call(["GET", capKey]));
    return Number.isFinite(stored) && stored > 0 ? Math.min(configured, stored) : configured;
  };

  return {
    enabled: true,
    cap: effective,
    async reserve(cents) {
      const cap = await effective();
      const next = Number(await call(["INCRBY", spentKey, String(cents)]));
      // The first write in the window starts the clock.
      if (next === cents) await call(["EXPIRE", spentKey, "86400"]);
      if (next > cap) {
        await call(["DECRBY", spentKey, String(cents)]);
        return { ok: false, spentCents: Math.max(0, next - cents), cap, wouldSpend: cents };
      }
      return { ok: true, spentCents: next, cap, wouldSpend: cents };
    },
    async release(cents) {
      await call(["DECRBY", spentKey, String(cents)]);
    },
    async read() {
      const raw = await call(["GET", spentKey]);
      return { spentCents: Number(raw ?? 0), cap: await effective() };
    },
    async tighten(cents) {
      const current = await effective();
      const next = Math.min(current, cents);
      await call(["SET", capKey, String(next), "EX", "86400"]);
      return { cap: next, changed: next < current };
    },
  };
}

/**
 * The honest no-op. Announces itself; never pretends to a number.
 *
 * This is the PRD's third resolution, chosen deliberately over silently keeping
 * a counter that resets between two clicks. Tightening is refused here too —
 * offering a control that cannot bind would be the same lie in a smaller box.
 */
function disabledStore(reason: string): SpendStore {
  return {
    enabled: false,
    reason,
    async cap() {
      return 0;
    },
    async reserve(cents) {
      return { ok: true, spentCents: 0, cap: 0, wouldSpend: cents };
    },
    async release() {},
    async read() {
      return null;
    },
    async tighten() {
      return { cap: 0, changed: false };
    },
  };
}

/**
 * One key for the whole sitting, and it is deliberately not per-wallet.
 *
 * This used to be `console:${operator}` — the address the key derived to — which
 * was harmless while a console held exactly one key and became a hole the day it
 * could hold several: selecting a different wallet from the masthead handed you
 * a fresh, empty counter, so N wallets meant N times the ceiling. A seatbelt you
 * can unbuckle from a dropdown is not a seatbelt.
 *
 * A sitting is one console process, or one deploy's shared store. It is not a
 * wallet, and the ceiling has always claimed to bound the former.
 *
 * The in-memory path never took an operator, so it has always had this property;
 * this only brings the Redis path back in line with it.
 */
const SITTING_KEY = "console:sitting";

export function spendStore(): SpendStore {
  const cfg = config();
  if (cfg.kv) {
    return redisStore(cfg.maxSpendCents, cfg.kv, SITTING_KEY);
  }
  if (!cfg.ceilingEnabled) {
    return disabledStore(cfg.ceilingDisabledReason ?? "The ceiling cannot bound a sitting here.");
  }
  return memoryStore(cfg.maxSpendCents);
}
