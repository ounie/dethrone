import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { SRC, read } from "./graph";

/**
 * The chain read is a second outbound path, and this file is the line around it.
 *
 * `arena.ts` is the only module that may talk to the canon, because that is
 * where a payment can be attached and a signature minted. `chain.ts` talks to a
 * public RPC instead — and the whole argument for allowing it is that it is
 * structurally incapable of the things that rule exists to prevent.
 *
 * So the properties are asserted rather than assumed: read-only, no key, one
 * contract call, and a failure that returns null instead of taking the page
 * down with it.
 */
const CHAIN = read(join(SRC, "lib/chain.ts"));

describe("chain.ts reads and never writes", () => {
  it("is server-only", () => {
    expect(CHAIN).toMatch(/^import "server-only";/m);
  });

  it("uses a PUBLIC client — never a wallet client", () => {
    expect(CHAIN).toContain("createPublicClient");
    expect(CHAIN).not.toContain("createWalletClient");
  });

  it("never signs, sends, or writes", () => {
    for (const forbidden of [
      "writeContract",
      "sendTransaction",
      "signMessage",
      "signTypedData",
      "privateKeyToAccount",
      "sendRawTransaction",
    ]) {
      expect(CHAIN, `chain.ts references ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("never imports the key modules", () => {
    expect(CHAIN).not.toMatch(/from "\.\/(wallet|sign|pay)"/);
  });

  it("calls exactly one contract function, and it is a view", () => {
    expect(CHAIN).toContain("readContract");
    expect(CHAIN).toContain('stateMutability: "view"');
    expect([...CHAIN.matchAll(/functionName:/g)]).toHaveLength(1);
  });

  it("does not reach for the canon's base URL", () => {
    // The *expression*, not the word. This file's own doc comment names the
    // variable while explaining why it does not read it — the same prose-trips-
    // the-regex trap that made test/graph.ts parse instead of grep.
    expect(CHAIN).not.toMatch(/process\.env\.DETHRONE_BASE_URL/);
    expect(CHAIN).not.toMatch(/\bconfig\(\)\.baseUrl\b/);
  });

  it("degrades to null rather than throwing — a balance is a convenience", () => {
    expect(CHAIN).toMatch(/catch\s*\{\s*return null;\s*\}/);
  });

  it("pins USDC per network rather than trusting one address everywhere", () => {
    // Base mainnet and Base Sepolia USDC, as the arena's own env module names them.
    expect(CHAIN).toContain("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(CHAIN).toContain("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
  });

  it("points the explorer at the network actually configured", () => {
    expect(CHAIN).toContain("https://basescan.org");
    expect(CHAIN).toContain("https://sepolia.basescan.org");
  });
});
