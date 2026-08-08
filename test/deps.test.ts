import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { SRC, findPath, importGraph, read, rel, sourceFiles } from "./graph";

/**
 * PRD §11: *nothing reachable from `components/` or `lib/commands.ts`
 * transitively imports `wallet.ts`, `pay.ts` or `sign.ts` — a dependency test,
 * not a convention.*
 *
 * This is the invariant the whole trust boundary rests on. The browser is
 * allowed to know an address; it must never receive a key, a
 * signature-producing capability, or anything that transitively reaches one.
 */

const KEY_MODULES = [
  join(SRC, "lib/wallet.ts"),
  join(SRC, "lib/pay.ts"),
  join(SRC, "lib/sign.ts"),
];

describe("the key is unreachable from the client", () => {
  const graph = importGraph();
  const targets = new Set(KEY_MODULES);

  const entries = [
    ...sourceFiles(join(SRC, "components")),
    join(SRC, "lib/commands.ts"),
    join(SRC, "lib/capability.ts"),
  ];

  for (const entry of entries) {
    it(`${rel(entry)} cannot reach wallet.ts, pay.ts or sign.ts`, () => {
      const path = findPath(graph, entry, targets);
      expect(
        path === null,
        path ? `import path: ${path.map(rel).join("  →  ")}` : "",
      ).toBe(true);
    });
  }

  it("the entry list is not empty (a passing test over nothing proves nothing)", () => {
    expect(entries.length).toBeGreaterThan(3);
  });
});

/**
 * The second net.
 *
 * The dependency test above only runs when someone runs it. `server-only` makes
 * the same mistake a *build* error, which runs every time. Both exist because
 * either one alone is a single point of failure for the one invariant that
 * cannot be allowed to lapse quietly.
 */
describe("server-only marks every module that sees a key or a network", () => {
  const mustBeServerOnly = [
    "lib/wallet.ts",
    "lib/pay.ts",
    "lib/sign.ts",
    "lib/arena.ts",
    "lib/config.ts",
    "lib/rules.ts",
    "lib/spend.ts",
    "lib/chain.ts",
    "lib/registry.ts",
  ];

  for (const file of mustBeServerOnly) {
    it(`${file} imports "server-only"`, () => {
      expect(read(join(SRC, file))).toMatch(/^import "server-only";/m);
    });
  }
});

/**
 * `wallet.ts` deliberately exposes no way to read the raw key. A
 * `getPrivateKey()` export would be used within a month, and every caller of it
 * would be a new place a secret can escape.
 */
describe("wallet.ts exports no way to read the raw key", () => {
  it("has no export whose name suggests it returns the key", () => {
    const source = read(join(SRC, "lib/wallet.ts"));
    const exports = [...source.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]);
    expect(exports).not.toContain("privateKey");
    expect(exports).not.toContain("getPrivateKey");
    expect(exports).not.toContain("key");
  });
});
