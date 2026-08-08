import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { SRC, findPath, importGraph, read, rel, sourceFiles, ts, visitFile } from "./graph";

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
  {
    path: "/api/chat",
    why: "The agent's turn. It holds provider keys and calls a language model, but it reaches the canon only by invoking /api/act's own exported handler — so every gate in that file runs, in order, for every tool call. The import-graph assertion at the bottom of this file proves it structurally, and test/chat-route.test.ts pins that signed and paid tools stay proposals unless a server-held grant says otherwise.",
  },
];

/**
 * Files permitted to `fetch` somewhere that is not one of this console's own
 * routes, and why each one qualifies.
 *
 * This replaced two hard-coded `continue`s. The rule being protected is about
 * the **canon** — only `arena.ts` may send there — so a file qualifies here only
 * if it cannot reach the canon at all: it must not read `DETHRONE_BASE_URL` (the
 * first assertion below covers that globally) and must not import `config.ts`,
 * which is the only module that holds the resolved address (asserted per entry).
 *
 * ## What this list cannot see, stated plainly
 *
 * `sourceFiles()` walks `src/` only. Two of the agent's four providers reach the
 * network through an SDK, and one of those spawns a subprocess — all inside
 * `node_modules`, where this AST scan does not reach. **They will pass every
 * assertion in this file without appearing here, and that is a limit of the
 * technique, not a property of the code.** Do not read this list as the complete
 * inventory of outbound destinations. `test/chat-route.test.ts` closes the gap
 * from the other side, by pinning that each SDK is reachable from exactly one
 * file — which bounds how many places can ask it to do anything, even though
 * nothing here can bound what it then does.
 */
const OUTBOUND_EXEMPT: { path: string; why: string }[] = [
  {
    path: "lib/spend.ts",
    why: "Talks to the Upstash KV store, which is not the canon. It never reads the base URL, and it is what makes the ceiling hold across serverless invocations.",
  },
  {
    path: "lib/pay.ts",
    why: "Wraps fetch rather than calling the canon — it produces a paying fetch and hands it to arena.ts, so its fetch(input, init) forwards whatever URL arena.ts built.",
  },
  {
    path: "lib/chat/providers/openai-shape.ts",
    why: "Talks to an OpenAI-shaped model provider: OpenRouter, or an operator-supplied compatible endpoint. It receives a provider base URL as an argument, never reads the canon's, mints no signature and cannot attach a payment. Written with plain fetch on purpose, so that these call sites stay visible to this scan instead of hiding inside a client library.",
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
    //
    // The agent introduced a second, unrelated meaning for "base URL": a model
    // provider's endpoint. `openai-shape.ts` holds one, and it is not the
    // canon's — it arrives as an argument, and that file never reads
    // DETHRONE_BASE_URL (the assertion above) nor imports config.ts (the
    // assertion below). So it is exempt by name, with the reason recorded, and
    // the exemption is backed by two checks rather than by a rename.
    const exempt = new Set(OUTBOUND_EXEMPT.map((e) => join(SRC, e.path)));
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (file === ARENA || exempt.has(file)) continue;
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
    const exempt = new Set(OUTBOUND_EXEMPT.map((e) => join(SRC, e.path)));
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      if (file === ARENA || exempt.has(file)) continue;

      visitFile(file, (node) => {
        if (!isFetchCall(node)) return;
        if (!isOwnRoute(node)) offenders.push(rel(file));
      });
    }

    expect(
      offenders,
      `unaccounted fetch call sites: ${[...new Set(offenders)].join(", ")}`,
    ).toEqual([]);
  });

  it("every outbound exemption exists, is justified, and cannot reach the canon", () => {
    for (const entry of OUTBOUND_EXEMPT) {
      const file = join(SRC, entry.path);
      expect(existsSync(file), `${entry.path} is exempt but does not exist — delete the entry`).toBe(
        true,
      );
      expect(entry.why.length, `${entry.path} has no reason`).toBeGreaterThan(30);

      // The one property that is true of all three, and the one the canon rule
      // actually rests on: an exempt file does not know where the arena is.
      //
      // Resisted the temptation to check something stronger and uniform, like
      // "does not import sign.ts". It would be wrong for a third of this list —
      // `pay.ts` imports both `sign.ts` and `wallet.ts`, because it *is* the
      // payment machinery; it is exempt for a different reason, which its own
      // `why` states. A mechanical check that is wrong for one entry teaches
      // the next reader to weaken it rather than to think, which is worse than
      // having no mechanical check at all.
      expect(read(file), `${entry.path} reads the canon's address`).not.toMatch(
        /process\.env\.DETHRONE_BASE_URL/,
      );
    }
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

  /**
   * The strong form of the rule above, and the reason it is needed.
   *
   * `/api/chat` genuinely does reach `arena.ts` — transitively, through the act
   * handler it invokes, which is the entire design. So the lexical check above
   * passes for a reason weaker than a reader would assume: it proves the chat
   * route does not *name* the arena module, not that it cannot get there by
   * some other route.
   *
   * This proves the real property. Blank the act route out of the import graph
   * and ask whether anything can still reach `arena.ts` from the chat route.
   *
   * ## There are exactly two doors, and the second one is `rules.ts`
   *
   * Cutting act alone does not isolate the chat route, and the honest thing is
   * to name why rather than to weaken the assertion until it passes. The route
   * calls `capabilities()`, which reads `GET /api/rules` to learn the live
   * prices and the interface version — the same read `page.tsx` does, through
   * the same cache. That is a **free, unsigned, unpaid** GET: it takes no
   * wallet, attaches no payment, and is the mechanism by which this console
   * avoids holding an opinion about prices.
   *
   * So both doors are blanked, and the assertion is that there is no third. If
   * this test ever fails, some module in the agent's tree has acquired a way to
   * reach the arena that is neither the guarded execution path nor the price
   * cache — which is exactly the change that should require an argument.
   */
  it("nothing reaches the canon from /api/chat except act and the rules cache", () => {
    const graph = importGraph();
    const act = join(SRC, "app/api/act/route.ts");
    const rules = join(SRC, "lib/rules.ts");
    const chat = join(SRC, "app/api/chat/route.ts");
    const canon = new Set([ARENA, join(SRC, "lib/pay.ts"), join(SRC, "lib/sign.ts")]);

    // With both present, a path exists — as it must, or this proves nothing.
    expect(findPath(graph, chat, canon)).not.toBeNull();

    // Cut the guarded path, and the price cache is what is left.
    graph.set(act, []);
    const viaRules = findPath(graph, chat, canon);
    expect(viaRules?.map(rel)).toContain("lib/rules.ts");

    // Cut that too, and there is no third way through.
    graph.set(rules, []);
    const detour = findPath(graph, chat, canon);
    expect(
      detour,
      detour ? `a third path to the canon: ${detour.map(rel).join("  →  ")}` : "",
    ).toBeNull();
  });

  /**
   * The narrower claim, and the one that would catch the dangerous version of
   * the above: nothing in the agent's own tree names the canon's modules.
   * `rules.ts` is reachable because the *route* asks for capabilities; no file
   * under `lib/chat/` may import a way to send, pay or sign.
   */
  it("no module under lib/chat can send, pay or sign", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(SRC, "lib/chat"))) {
      const source = read(file);
      if (/from "@\/lib\/(arena|pay|sign)"/.test(source)) offenders.push(rel(file));
      if (/from "\.\.?\/(arena|pay|sign)"/.test(source)) offenders.push(rel(file));
    }
    expect(offenders, `the agent's tree names the canon directly: ${offenders.join(", ")}`).toEqual(
      [],
    );
  });
});
