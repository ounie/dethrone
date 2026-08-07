import "server-only";
import { account } from "./wallet";

/**
 * Signed reads and writes: the EIP-191 triple the canon verifies.
 *
 * ## This format is copied, not invented
 *
 * Source of truth: the arena's `wallet-auth.ts` (`authMessage` and
 * `verifySigned`), mirrored by the reference client in `@dethrone/mcp`. A
 * signature that disagrees by one delimiter fails as a bare 401 with no useful
 * detail, which is an expensive way to learn. Four details are load-bearing and
 * each of them is a thing an earlier draft of this file got wrong:
 *
 *  1. **The headers are `x-wallet` / `x-timestamp` / `x-signature`.** Not
 *     `x-dethrone-*`.
 *  2. **The timestamp is unix MILLISECONDS**, and the *same string* goes into
 *     the message and the header. A re-stringified Number is a different
 *     message. The server's freshness window is ±60s, so a clock more than a
 *     minute out fails here and nowhere else — worth saying in a bug report.
 *  3. **`path` is the pathname only**, in its already-encoded form, and never
 *     the query string: the server rebuilds it from `new URL(req.url).pathname`.
 *  4. **The method is uppercased**, because the server uppercases before it
 *     compares.
 *
 * ## Retries, and why signed and paid are opposites
 *
 * A *paid* retry resends the identical x402 payload: the EIP-3009 nonce is
 * single-use, so a resend either completes the original request or fails as a
 * replay, and it cannot double-charge.
 *
 * A *signed* retry is the reverse. Every `(scope, wallet, timestamp)` is
 * accepted exactly once, so resending an identical triple is a guaranteed
 * `401 signature replay detected`. A signed retry MUST re-sign with a fresh
 * timestamp. These two rules look contradictory and are both true; conflating
 * them is how a retry loop becomes either a second payment or a permanent 401.
 */

/** The exact string `verifySigned` rebuilds. Do not reformat. */
export function authMessage(
  scope: string,
  method: string,
  encodedPath: string,
  timestampMs: string,
): string {
  return `dethrone:${scope}:${method.toUpperCase()}:${encodedPath}:${timestampMs}`;
}

export class NoWalletError extends Error {
  constructor() {
    super("NO_WALLET");
    this.name = "NoWalletError";
  }
}

/**
 * The header triple for one signed request.
 *
 * `encodedPath` must be the pathname exactly as it will appear in the URL —
 * segments already percent-encoded, no query string, no origin.
 */
export async function signedHeaders(
  scope: string,
  method: string,
  encodedPath: string,
): Promise<Record<string, string>> {
  const acct = account();
  if (!acct) throw new NoWalletError();

  const timestamp = Date.now().toString();

  return {
    "x-wallet": acct.address,
    "x-timestamp": timestamp,
    "x-signature": await acct.signMessage({
      message: authMessage(scope, method, encodedPath, timestamp),
    }),
  };
}

/**
 * Resolve a `signScope` template against the command's filled arguments.
 *
 * The scope uses the **raw** value while the path uses the **encoded** one. For
 * the ids in play today those coincide, but writing the rule down is the only
 * thing that stops it breaking silently the first time an id contains a
 * character that encodes: the server derives its scope from the decoded route
 * param, so the console must sign the decoded form too.
 */
export function resolveScope(template: string, args: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_, name: string) => args[name] ?? "");
}
