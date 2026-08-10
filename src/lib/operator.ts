/**
 * Which wallets this console holds a key for, as the browser is allowed to know
 * them.
 *
 * This type lives in its own module for the same structural reason
 * `capability.ts` and `agent.ts` do. It is produced by `lib/wallet.ts` — the one
 * module that has ever seen a key — and consumed by `components/masthead.tsx`,
 * which must never be able to reach it. An inline `import { type X }` from the
 * producing module counts as a runtime edge and would fail `test/deps.test.ts`;
 * a value-free sibling is how the type stays single-sourced without the edge.
 *
 * ## Named `operator.ts` and not `wallets.ts`, deliberately
 *
 * `lib/wallets.ts` sits one character from `lib/wallet.ts`. A mistyped import in
 * a client component would land on the key module, and the only thing catching
 * it would be a test somebody remembered to run. A name that cannot be confused
 * is worth more than a name that is marginally more descriptive.
 *
 * Nothing here is a value. There is no default, no list, no lookup — a table of
 * wallets in a module a browser can import is the beginning of the browser
 * having an opinion about who signs, and the whole point is that it does not.
 */

export interface WalletChoice {
  /**
   * Stable id, derived from the environment variable's suffix. Compared, never
   * rendered — and never an index. An index is a position in a list the client
   * got from a previous render, which is the argument `lib/combos.ts` already
   * makes at length about action ids.
   */
  id: string;
  /** What the picker says. Derived from the variable NAME, never from the key. */
  label: string;
  /** Public. The key that derives it never crosses this boundary. */
  address: string;
  /**
   * Which line of `.env.local` this wallet came from.
   *
   * A name, not a value. `scripts/scan-bundle.ts` scans the client bundle for
   * key-*shaped* strings precisely because names are fine there and values are
   * not — and this one earns its place: it tells the operator exactly which
   * variable is about to sign.
   */
  envVar: string;
}
