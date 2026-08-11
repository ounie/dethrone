import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { SRC, read } from "./graph";

/**
 * The gate is on every route, and it is FIRST.
 *
 * Two halves, and the structural one is the point. A behavioural test proves a
 * route refuses an anonymous caller today; it says nothing about *where* the
 * refusal sits, so a later edit that moves the check below the body parse — or
 * below the wallet check, or below the arena call — keeps every behavioural
 * assertion green while reopening exactly what the gate was for.
 *
 * This is the same technique `test/fighters-pane.test.ts` uses to prove that
 * panel cannot spend: read the source and assert the property, rather than
 * hoping a scenario happens to exercise it.
 */

const KEY = "0x" + "e".repeat(64);
const PASSWORD = "correct horse battery staple";

const ROUTES = ["act", "chat", "wallet", "ceiling"] as const;

/**
 * Comments stripped, because this test indexes on source positions and the
 * comments explaining the ordering necessarily quote the very strings being
 * indexed. That is not a hypothetical: the gate comment in `/api/act` says
 * "Above `req.json()`", which the first version of this file found *before* the
 * gate and reported as the gate being in the wrong place.
 *
 * `test/doc-claims.test.ts` carries the same trap one level up, and its comment
 * is worth reading — the arena's canon sync decided a route was paid by grepping
 * for a wrapper its doc comment merely denied, and then the comment explaining
 * that did it again.
 */
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("every route authenticates before it does anything else", () => {
  for (const name of ROUTES) {
    it(`/api/${name} calls authenticate() above its body parse`, () => {
      const source = code(join(SRC, `app/api/${name}/route.ts`));

      const gate = source.indexOf("authenticate(req)");
      expect(gate, `/api/${name} does not authenticate at all`).toBeGreaterThan(-1);

      // `req.json()` is where an unauthenticated caller would first get this
      // process to do work on their behalf.
      const parse = source.indexOf("req.json()");
      expect(parse, `/api/${name} has no body parse — has this route changed shape?`).toBeGreaterThan(-1);
      expect(gate, `/api/${name} authenticates after parsing the body`).toBeLessThan(parse);
    });
  }

  /**
   * The narrower claim, and the one that would catch the dangerous version:
   * `/api/act` must not gate only paid commands the way its host check does.
   * The `signed` tier mints a signature with the operator's key and includes a
   * destructive command, so a gate inside `if (paid)` would leave the reachable
   * hazard untouched.
   */
  it("/api/act's gate is not nested inside its paid branch", () => {
    const source = code(join(SRC, "app/api/act/route.ts"));
    expect(source.indexOf("authenticate(req)")).toBeLessThan(source.indexOf("const paid ="));
  });

  /**
   * `paidCommandsAllowedFrom` takes the session rather than reading it, so a
   * caller that has not authenticated has nothing to pass and `tsc` says so.
   * Pinned because the one-line "simplification" — having it call
   * `authenticate()` itself — reintroduces a function that returns true for a
   * request that proved nothing.
   */
  it("the host gate is handed the session rather than fetching it", () => {
    const source = read(join(SRC, "lib/config.ts"));
    expect(source).toMatch(/export function paidCommandsAllowedFrom\([\s\S]*?session: SessionState/);
    // The module boundary, not the word: `config.ts` may *discuss* authenticate
    // in the comment explaining why it does not call it, and must not import it.
    expect(source, "config.ts reaches the auth module for itself").not.toMatch(
      /from "\.\/auth"|from "@\/lib\/auth"/,
    );
  });

  /**
   * The bridge copies the session the way it copies the Host: verbatim.
   * Synthesising one would be a hole straight through the gate, and omitting it
   * would 401 every tool call — whose tempting fix is to skip the gate for the
   * bridge.
   */
  it("the chat bridge forwards the cookie and does not invent one", () => {
    const source = read(join(SRC, "lib/chat/act-bridge.ts"));
    expect(source).toContain('origin.headers.get("cookie")');
    expect(source).toMatch(/headers\.set\("cookie", cookie\)/);
    expect(source, "the bridge builds a cookie value of its own").not.toMatch(
      /headers\.set\("cookie", ["'`]/,
    );
  });
});

describe("with a password set, an anonymous request gets nowhere", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CONSOLE_PASSWORD = PASSWORD;
    process.env.DETHRONE_PRIVATE_KEY = KEY;
    process.env.HOST = "127.0.0.1";
    delete process.env.VERCEL;
  });

  afterEach(() => {
    delete process.env.CONSOLE_PASSWORD;
    delete process.env.DETHRONE_PRIVATE_KEY;
  });

  for (const name of ROUTES) {
    it(`/api/${name} answers 401 and makes no outbound request`, async () => {
      const arena = await import("@/lib/arena");
      const call = vi.spyOn(arena, "call");

      // Spelled out rather than built from `name`: a template import is a
      // dynamic one, which the bundler cannot resolve statically and warns
      // about. Four literals cost less than the warning.
      const mod = await (name === "act"
        ? import("@/app/api/act/route")
        : name === "chat"
          ? import("@/app/api/chat/route")
          : name === "wallet"
            ? import("@/app/api/wallet/route")
            : import("@/app/api/ceiling/route"));
      const POST = mod.POST as (req: Request) => Promise<Response>;
      const res = await POST(
        new Request(`http://127.0.0.1:3939/api/${name}`, {
          method: "POST",
          headers: { host: "127.0.0.1:3939", "content-type": "application/json" },
          body: JSON.stringify({ id: "seat", capCents: 1, message: "hello" }),
        }),
      );

      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("CONSOLE_UNAUTHENTICATED");
      // The property the ordering exists for: nothing left the process.
      expect(call).not.toHaveBeenCalled();

      call.mockRestore();
    });
  }
});

describe("with no password set, the gate is inert", () => {
  /**
   * The constraint the whole feature hangs on. A fresh clone on loopback must
   * behave exactly as it did before this existed — no login screen, no cookie,
   * no change. It is also what keeps every other route test in this repo
   * meaningful without threading a session through it.
   */
  beforeEach(() => {
    vi.resetModules();
    delete process.env.CONSOLE_PASSWORD;
  });

  it("authenticate() reports not-required and never refuses", async () => {
    const { authenticate, passwordRequired } = await import("@/lib/auth");
    expect(passwordRequired()).toBe(false);
    const state = await authenticate(
      new Request("http://127.0.0.1:3939/api/act", { method: "POST" }),
    );
    expect(state).toBe("not-required");
  });

  it("does not stand in for a real session on a hosted deploy", async () => {
    // `"not-required"` must not satisfy the hosted branch of the host gate.
    //
    // Reaching this needs a *bootable* Railway deploy, which is why the password
    // is set here: assertion 11 refuses to start one holding a key without it, so
    // the combination "hosted, keyed, no password" cannot be constructed at all —
    // which is the assertion doing its job. What is being pinned is the narrower
    // thing: even on a deploy that has a door, only a request that came through
    // it counts.
    vi.resetModules();
    process.env.RAILWAY_ENVIRONMENT = "production";
    process.env.DETHRONE_PRIVATE_KEY = KEY;
    process.env.CONSOLE_PASSWORD = PASSWORD;

    const { paidCommandsAllowedFrom } = await import("@/lib/config");
    expect(paidCommandsAllowedFrom("console.up.railway.app", "valid")).toBe(true);
    expect(paidCommandsAllowedFrom("console.up.railway.app", "not-required")).toBe(false);
    expect(paidCommandsAllowedFrom("console.up.railway.app", "invalid")).toBe(false);

    delete process.env.RAILWAY_ENVIRONMENT;
    delete process.env.DETHRONE_PRIVATE_KEY;
    delete process.env.CONSOLE_PASSWORD;
  });
});
