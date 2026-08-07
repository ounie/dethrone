/**
 * What this deploy can actually run, decided on the server and shipped to the
 * browser as data.
 *
 * This type lives in its own module for a structural reason, not a stylistic
 * one. It is shared between `app/page.tsx` (which computes it, and which
 * imports the wallet) and `components/console.tsx` (which renders it, and which
 * must never be able to reach the wallet). If the client imported the type from
 * the page, there would be an edge in the import graph from a client component
 * to a module that reads a private key — erased at compile time, harmless at
 * runtime, and exactly the kind of edge that is one refactor away from becoming
 * real.
 *
 * `test/deps.test.ts` asserts that edge does not exist. This file is how it
 * stays true without the type being duplicated.
 */
export interface Capability {
  enabled: boolean;
  /**
   * Rendered verbatim beside a disabled command.
   *
   * The client never infers this. "Read-only", "duels are closed", "the arena
   * reports a different interface" are all facts the server established by
   * asking; a browser that worked them out for itself would be a second
   * implementation of the rules.
   */
  reason?: string;
  /** The live price in cents where the canon publishes one, else undefined. */
  liveCents?: number;
}

export type Capabilities = Record<string, Capability>;

/** The stake bounds the canon published, for a placeholder. Never enforced here. */
export interface StakeRange {
  enabled: boolean;
  minStakeCents: number | null;
  maxStakeCents: number | null;
}
