import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { existsSync } from "node:fs";
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

/**
 * The console's own same-origin routes, and why each is allowed to exist.
 *
 * This is an ALLOWLIST, not a prefix match, so adding a third route is a
 * deliberate edit to this file rather than something that slips in. The rule
 * being protected is about the canon: only `arena.ts` may reach
 * `DETHRONE_BASE_URL`. A same-origin route can qualify only if it cannot
 * attach a payment, mint a signature, or let a spend go uncounted.
 */
const OWN_ROUTES: { path: string; why: string }[] = [
  { path: "/api/act", why: "The one execution path. Everything that reaches the canon goes here." },
  {
    path: "/api/ceiling",
    why: "Tightens the local spend ceiling. Makes no outbound request, holds no key, and can only ever LOWER the cap — test/ceiling-route.test.ts pins that.",
  },
];

function literalTarget(node: ts.CallExpression): string | null {
  const first = node.arguments[0];
  if (!first) return null;
  if (ts.isStringLiteral(first)) return first.text;
  if (ts.isTemplateExpression(first)) return first.head.text;
  if (ts.isNoSubstitutionTemplateLiteral(first)) return first.text;
  return null;
}

/** Same-origin calls to the console's own routes are not calls to the canon. */
function isOwnRoute(node: ts.CallExpression): boolean {
  const target = literalTarget(node);
  return target !== null && OWN_ROUTES.some((r) => target.startsWith(r.path));
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

  it("the client only ever calls the console's own routes", () => {
    const offenders: string[] = [];
    let total = 0;
    for (const file of sourceFiles(join(SRC, "components"))) {
      visitFile(file, (node) => {
        if (!isFetchCall(node)) return;
        total++;
        if (!isOwnRoute(node)) offenders.push(`${rel(file)} → ${literalTarget(node) ?? "<dynamic>"}`);
      });
    }
    expect(offenders, `the client reaches somewhere unaccounted for: ${offenders.join(", ")}`).toEqual([]);
    // And there is at least one, or the test is vacuous.
    expect(total).toBeGreaterThan(0);
  });

  it("every allowed own-route exists and carries a stated reason", () => {
    for (const route of OWN_ROUTES) {
      const handler = join(SRC, "app", route.path.slice(1), "route.ts");
      expect(
        existsSync(handler),
        `${route.path} is allowlisted but has no handler — delete the entry`,
      ).toBe(true);
      expect(route.why.length, `${route.path} has no reason`).toBeGreaterThan(30);
    }
  });

  it("only /api/act is allowed to reach the canon", () => {
    // The other own-routes must not import the module that talks to the arena.
    for (const route of OWN_ROUTES) {
      if (route.path === "/api/act") continue;
      const source = read(join(SRC, "app", route.path.slice(1), "route.ts"));
      expect(source, `${route.path} imports arena.ts`).not.toMatch(/from "@\/lib\/arena"/);
      expect(source, `${route.path} imports pay.ts`).not.toMatch(/from "@\/lib\/pay"/);
      expect(source, `${route.path} imports sign.ts`).not.toMatch(/from "@\/lib\/sign"/);
    }
  });
});
