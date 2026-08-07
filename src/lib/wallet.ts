import "server-only";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toBytes, type PrivateKeyAccount } from "viem";

/**
 * The key. **One of two modules that has ever seen it**, and the other one
 * (`sign.ts`) gets it from here rather than from the environment.
 *
 * `import "server-only"` is the structural half of the guarantee: a client
 * component that imports this, directly or through six hops, is a *build*
 * error rather than a red test. `test/deps.test.ts` is the other half, and it
 * runs only when someone runs it — which is why both exist.
 *
 * Nothing here exports the raw key. There is no `getPrivateKey()` to misuse:
 * the one caller that needs the literal string for redaction reads
 * `process.env` itself, in the route, where that intent is visible.
 */

let cached: PrivateKeyAccount | null | undefined;

const KEY_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * The account, or `null` when no key is configured.
 *
 * **`null` is a supported mode, not a failure.** Without a key the console
 * boots, every free read works, and every paid command renders disabled with
 * the reason. A fresh clone cannot cost anything on its first run, and the
 * public read-only deploy is this branch taken permanently.
 */
export function account(): PrivateKeyAccount | null {
  if (cached !== undefined) return cached;

  const raw = process.env.DETHRONE_PRIVATE_KEY?.trim();
  if (!raw) {
    cached = null;
    return cached;
  }

  if (!KEY_RE.test(raw)) {
    // Fail loudly at parse, not at settle. A malformed key that reaches the
    // facilitator surfaces as an opaque payment error three layers down, after
    // a request has already left the process. `assertions.ts` catches this at
    // boot; this is the backstop for a key set after boot.
    throw new Error(
      "DETHRONE_PRIVATE_KEY is not a 32-byte hex key (expected 0x + exactly 64 hex characters)",
    );
  }

  cached = privateKeyToAccount(raw as `0x${string}`);
  return cached;
}

export function address(): `0x${string}` | null {
  return account()?.address ?? null;
}

/** Read-only mode is the correct default: no key, free reads still work. */
export function hasWallet(): boolean {
  return account() !== null;
}

/**
 * A short, stable, public tag for correlating log lines across a sitting.
 *
 * Derived from the **address**, not the key — an address is already public, so
 * this reveals nothing a `GET /api/seat` would not. It exists because a log
 * line that identifies which wallet acted is useful and a log line that
 * identifies it by a slice of its key is a leak.
 */
export function keyFingerprint(): string | null {
  const addr = address();
  return addr ? keccak256(toBytes(addr)).slice(2, 10) : null;
}

/** Test seam. Never called in production; resets the memo between cases. */
export function __resetWalletCache(): void {
  cached = undefined;
}
