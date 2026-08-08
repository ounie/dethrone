import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { SRC, read, rel, sourceFiles, ts, visitFile } from "./graph";

/**
 * PRD §11: *exactly one module issues a request to `DETHRONE_BASE_URL`; the
 * enumeration test fails on a second.*
 *
 * The rule is not tidiness. A second call site is a second place where a
 * payment can be attached, a signature can be minted, or a spend can go
 * uncounted — and the entire safety argument of this console is that there is
 * one path and every guard sits on it.
 */

const ARENA = join(SRC, "lib/arena.ts");

/** Same-origin calls to the console's own route are not calls to the canon. */
function isOwnRoute(node: ts.CallExpression): boolean {
  const first = node.arguments[0];
  if (!first) return false;
  if (ts.isStringLiteral(first)) return first.text.startsWith("/api/act");
  if (ts.isTemplateExpression(first)) return first.head.text.startsWith("/api/act");
  if (ts.isNoSubstitutionTemplateLiteral(first)) return first.text.startsWith("/api/act");
  return false;
}

function isFetchCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === "fetch";
  if (ts.isPropertyAccessExpression(callee)) {
    return (
      callee.name.text === "fetch" &&
      ts.isIdentifier(callee.expression) &&
      ["globalThis", "window", "self"].includes(callee.expression.text)
    );
  }
  return false;
}

describe("exactly one door to the canon", () => {
  it("only config.ts reads DETHRONE_BASE_URL from the environment", () => {
    const offenders = sourceFiles()
      .filter((file) => file !== join(SRC, "lib/config.ts"))
      .filter((file) => /process\.env\.DETHRONE_BASE_URL/.test(read(file)))
      .map(rel);
    expect(offenders, `these files read the base URL directly: ${offenders.join(", ")}`).toEqual([]);
  });

  it("only arena.ts both holds the base URL and can send somewhere other than /api/act", () => {
    // Reading the base URL to *display* it is fine, and the masthead does
    // exactly that — which arena this console points at is a fact the operator
    // needs. Fetching the console's own route is fine too; that is how every
    // button works.
    //
    // What must be unique is the dangerous combination: holding the canon's
    // address AND being able to send to somewhere that is not this app. Testing
    // for `baseUrl && fetch` was too coarse and flagged the component that does
    // both harmless things at once.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (file === ARENA) continue;
      if (!/\bbaseUrl\b/.test(read(file))) continue;
      visitFile(file, (node) => {
        if (isFetchCall(node) && !isOwnRoute(node)) offenders.push(rel(file));
      });
    }
    expect(
      offenders,
      `these files hold the base URL and can send somewhere unaccounted for: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("every fetch outside arena.ts targets the console's own route", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      if (file === ARENA) continue;
      // spend.ts talks to the KV store, which is not the canon. It is exempt
      // from THIS rule and covered by the rule above, which it passes: it never
      // reads the base URL.
      if (file === join(SRC, "lib/spend.ts")) continue;

      visitFile(file, (node) => {
        if (!isFetchCall(node)) return;
        // pay.ts wraps fetch rather than calling the canon — it produces a fetch
        // and hands it to arena.ts. Its `fetch(input, init)` forwards whatever
        // URL arena.ts built.
        if (file === join(SRC, "lib/pay.ts")) return;
        if (!isOwnRoute(node)) offenders.push(rel(file));
      });
    }

    expect(
      offenders,
      `unaccounted fetch call sites: ${[...new Set(offenders)].join(", ")}`,
    ).toEqual([]);
  });

  it("the client makes exactly one kind of request, and it is to /api/act", () => {
    const clientFetches: string[] = [];
    for (const file of sourceFiles(join(SRC, "components"))) {
      visitFile(file, (node) => {
        if (isFetchCall(node)) clientFetches.push(isOwnRoute(node) ? "own" : rel(file));
      });
    }
    expect(clientFetches.every((f) => f === "own")).toBe(true);
    // And there is at least one, or the test is vacuous.
    expect(clientFetches.length).toBeGreaterThan(0);
  });
});
