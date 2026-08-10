import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { SRC, read, rel, sourceFiles } from "./graph";

/**
 * `/api/chat`, driven through the real handler with the arena stubbed and a
 * scripted provider standing in for a language model. No LLM is contacted here.
 *
 * The case that matters most in this file is "a body cannot grant itself
 * autonomy". Everything else pins behaviour; that one pins the absence of a
 * bypass, and it is the assertion a plausible refactor is most likely to break
 * silently — the natural way to write a mode is as a request field, and it
 * would work perfectly in every manual test.
 */

const KEY = "0x" + "c".repeat(64);
const PROVIDER_KEY = "sk-or-v1-" + "z".repeat(48);

const call = vi.fn();
const replay = vi.fn();

vi.mock("@/lib/arena", () => ({
  call: (...args: unknown[]) => call(...args),
  replay: (...args: unknown[]) => replay(...args),
  interfaceMatches: () => true,
}));

vi.mock("@/lib/rules", () => ({
  rules: async () => ({
    reachable: true,
    interfaceVersion: "interface-v2",
    interfaceMatches: true,
    money: { forge: 10, challenge: 100, filmOrder: 60 },
    forgeNote: null,
    duel: { enabled: true, minStakeCents: 100, maxStakeCents: 10000 },
    features: { duels: true },
    arena: null,
    fetchedAt: 0,
  }),
}));

/**
 * The scripted model.
 *
 * `SCRIPT` is a queue of tool calls the fake provider will make, in order. It
 * runs them through the executor it was handed — the real one — so the route's
 * behaviour is exercised end to end with only the model's judgement replaced.
 */
const SCRIPT: { name: string; args?: Record<string, unknown> }[] = [];
let providerThrows: Error | null = null;

vi.mock("@/lib/chat/providers/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/providers/registry")>();
  return {
    ...actual,
    adapterFor: async (id: string) => {
      if (!process.env.OPENROUTER_API_KEY) return null;
      return {
        id,
        run: async (
          _input: unknown,
          execute: (c: { id: string; name: string; args: Record<string, unknown> }) => Promise<{
            event: unknown;
          }>,
        ) => {
          if (providerThrows) throw providerThrows;
          const events: unknown[] = [];
          for (const [i, step] of SCRIPT.entries()) {
            const out = await execute({ id: `c${i}`, name: step.name, args: step.args ?? {} });
            events.push(out.event);
          }
          return events;
        },
      };
    },
    providerStatuses: async () => {
      const available = !!process.env.OPENROUTER_API_KEY;
      return [
        {
          id: "openrouter",
          label: "OpenRouter",
          available,
          ...(available ? {} : { reason: "No OPENROUTER_API_KEY on this deploy." }),
          models: available ? [{ id: "test/model", label: "Test" }] : [],
        },
      ];
    },
  };
});

function ok(body: unknown = { ok: true }, status = 200) {
  return {
    result: {
      status,
      ok: status < 300,
      ms: 9,
      body,
      interfaceVersion: "interface-v2",
      featureDisabled: false,
      settlement: { success: true, payer: "0x1", transaction: "0x2" },
    },
    attempt: {},
  };
}

async function post(payload: unknown, host = "127.0.0.1:3939") {
  const { POST } = await import("@/app/api/chat/route");
  const res = await POST(
    new Request("http://127.0.0.1:3939/api/chat", {
      method: "POST",
      headers: { host, "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  // Deliberately loose: these assertions are about the wire shape, and typing
  // the envelope here would just restate the route's own types back at it.
  return { status: res.status, body: (await res.json()) as any };
}

function turn(extra: Record<string, unknown> = {}) {
  return {
    kind: "turn",
    provider: "openrouter",
    model: "test/model",
    message: "do the thing",
    history: [],
    ...extra,
  };
}

/** Walk the challenge → echo handshake and return the grant response. */
async function enableAutonomy() {
  const challenge = await post({ kind: "autonomy", enable: true });
  expect(challenge.status).toBe(428);
  const d = challenge.body.error.detail as unknown as {
    operator: string;
    acknowledgement: string;
    nonce: string;
  };
  return post({
    kind: "autonomy",
    enable: true,
    confirm: { operator: d.operator, acknowledgement: d.acknowledgement, nonce: d.nonce },
  });
}

beforeEach(() => {
  vi.resetModules();
  call.mockReset();
  replay.mockReset();
  SCRIPT.length = 0;
  providerThrows = null;
  vi.stubEnv("DETHRONE_PRIVATE_KEY", KEY);
  vi.stubEnv("DETHRONE_BASE_URL", "http://127.0.0.1:3000");
  vi.stubEnv("CONSOLE_MAX_SPEND_CENTS", "1000");
  vi.stubEnv("CONSOLE_CONFIRM_OVER_CENTS", "1000");
  vi.stubEnv("CONSOLE_AUTONOMY_MAX_CENTS", "50");
  vi.stubEnv("CONSOLE_ALLOW_FULL_AUTONOMY", "true");
  vi.stubEnv("OPENROUTER_API_KEY", PROVIDER_KEY);
  vi.stubEnv("HOST", "127.0.0.1");
  delete (globalThis as Record<string, unknown>).__dethrone_console_spent__;
  delete (globalThis as Record<string, unknown>).__dethrone_console_autonomy__;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("status", () => {
  it("reports the pane disabled, with a reason, when no provider is configured", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const res = await post({ kind: "status" });

    expect(res.body.enabled).toBe(false);
    expect(String(res.body.reason).length).toBeGreaterThan(20);
    expect(res.body.providers[0]).toMatchObject({ available: false });
    expect(String(res.body.providers[0].reason).length).toBeGreaterThan(10);
  });

  it("reports what is available, and picks a default", async () => {
    const res = await post({ kind: "status" });
    expect(res.body.enabled).toBe(true);
    expect(res.body.defaultProviderId).toBe("openrouter");
    expect(res.body.defaultModelId).toBe("test/model");
  });

  it("carries no provider key", async () => {
    const res = await post({ kind: "status" });
    expect(JSON.stringify(res.body)).not.toContain(PROVIDER_KEY);
  });

  it("says autonomy is offerable here, and that it is not on", async () => {
    const res = await post({ kind: "status" });
    expect(res.body.autonomy).toMatchObject({ offerable: true, active: false });
  });

  it("says why autonomy is not offerable when the opt-in is absent", async () => {
    vi.stubEnv("CONSOLE_ALLOW_FULL_AUTONOMY", "");
    const res = await post({ kind: "status" });
    expect(res.body.autonomy.offerable).toBe(false);
    expect(String(res.body.autonomy.reason)).toContain("CONSOLE_ALLOW_FULL_AUTONOMY");
  });
});

describe("a request body cannot grant itself authority", () => {
  it("ignores every plausible invented field and still proposes", async () => {
    // The assertion this whole file exists for. Each of these is the field
    // someone would naturally add while making the toggle "work".
    call.mockResolvedValue(ok());
    SCRIPT.push({ name: "dethrone_forge" });

    for (const invented of [
      { mode: "full" },
      { autonomy: "full" },
      { fullAutonomy: true },
      { confirm: { amountCents: 10, payer: "0x1" } },
    ]) {
      call.mockClear();
      const res = await post(turn(invented));

      expect(res.status).toBe(200);
      expect(res.body.mode).toBe("reads");
      const kinds = (res.body.events as unknown as { type: string }[]).map((e) => e.type);
      expect(kinds, `granted by ${JSON.stringify(invented)}`).toContain("proposal");
      expect(call, `a request left the process for ${JSON.stringify(invented)}`).not.toHaveBeenCalled();
    }
  });
});

describe("the autonomy handshake, over the wire", () => {
  it("428s with the terms the server composed", async () => {
    const res = await post({ kind: "autonomy", enable: true });

    expect(res.status).toBe(428);
    expect(res.body.error.code).toBe("CONSOLE_AUTONOMY_CONFIRM_REQUIRED");
    const detail = res.body.error.detail as unknown as Record<string, unknown>;
    expect(detail.operator).toBeTruthy();
    expect(detail.perActionCapCents).toBe(50);
    expect(detail.capCents).toBe(1000);
    expect(String(detail.acknowledgement)).toContain("without asking");
    expect(detail.nonce).toBeTruthy();
  });

  it("grants on a verbatim echo", async () => {
    const res = await enableAutonomy();
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);

    const status = await post({ kind: "status" });
    expect(status.body.autonomy.active).toBe(true);
  });

  it("refuses a fabricated nonce", async () => {
    const challenge = await post({ kind: "autonomy", enable: true });
    const d = challenge.body.error.detail as unknown as Record<string, string>;

    const res = await post({
      kind: "autonomy",
      enable: true,
      confirm: { operator: d.operator, acknowledgement: d.acknowledgement, nonce: "invented" },
    });

    expect(res.status).toBe(428);
    expect((res.body.error.detail as unknown as Record<string, string>).rejected).toBe("nonce");
  });

  it("hands back a fresh challenge on rejection, rather than a dead end", async () => {
    const challenge = await post({ kind: "autonomy", enable: true });
    const d = challenge.body.error.detail as unknown as Record<string, string>;

    const res = await post({
      kind: "autonomy",
      enable: true,
      confirm: { operator: d.operator, acknowledgement: "not what I read", nonce: d.nonce },
    });

    const detail = res.body.error.detail as unknown as Record<string, string>;
    expect(detail.rejected).toBe("acknowledgement");
    expect(detail.nonce).toBeTruthy();
    expect(detail.nonce).not.toBe(d.nonce);
  });

  it("refuses to offer a grant where it is not offerable", async () => {
    vi.stubEnv("CONSOLE_ALLOW_FULL_AUTONOMY", "");
    const res = await post({ kind: "autonomy", enable: true });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONSOLE_AUTONOMY_UNAVAILABLE");
  });

  it("revokes in one call, with nothing to confirm", async () => {
    await enableAutonomy();
    const res = await post({ kind: "autonomy", enable: false });

    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
    expect((await post({ kind: "status" })).body.autonomy.active).toBe(false);
  });

  it("dies when the operator switches wallet", async () => {
    // The second key is stubbed inside the case rather than in `beforeEach`, so
    // every other case in this file keeps its single-wallet world.
    vi.stubEnv("DETHRONE_PRIVATE_KEY_SCRAPYARD", "0x" + "b".repeat(64));
    vi.resetModules();
    delete (globalThis as Record<string, unknown>).__dethrone_console_wallet__;

    await enableAutonomy();
    expect((await post({ kind: "status" })).body.autonomy.active).toBe(true);

    const { POST } = await import("@/app/api/wallet/route");
    const switched = await POST(
      new Request("http://127.0.0.1:3939/api/wallet", {
        method: "POST",
        headers: { host: "127.0.0.1:3939", "content-type": "application/json" },
        body: JSON.stringify({ id: "scrapyard" }),
      }),
    );
    expect(((await switched.json()) as { autonomyRevoked: boolean }).autonomyRevoked).toBe(true);

    // An acknowledgement names an address. Carrying the grant to a wallet
    // nobody confirmed is the one thing the handshake exists to prevent.
    expect((await post({ kind: "status" })).body.autonomy.active).toBe(false);

    delete (globalThis as Record<string, unknown>).__dethrone_console_wallet__;
  });
});

describe("a turn", () => {
  it("runs a free read and reports the ceiling alongside it", async () => {
    call.mockResolvedValue(ok({ champion: "Rook" }));
    SCRIPT.push({ name: "dethrone_seat" });

    const res = await post(turn());

    expect(res.status).toBe(200);
    expect((res.body.events as unknown as { type: string }[])[0].type).toBe("executed");
    expect(res.body.ceiling).toMatchObject({ enabled: true });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("executes a paid command only once a grant is live", async () => {
    call.mockResolvedValue(ok({ characterId: 7 }, 202));
    SCRIPT.push({ name: "dethrone_forge" });

    expect((await post(turn())).body.mode).toBe("reads");
    expect(call).not.toHaveBeenCalled();

    await enableAutonomy();
    const res = await post(turn());

    expect(res.body.mode).toBe("full");
    expect((res.body.events as unknown as { type: string }[])[0].type).toBe("executed");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("refuses a provider this deploy cannot run, in that provider's own words", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const res = await post(turn());

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONSOLE_CHAT_PROVIDER_UNAVAILABLE");
  });

  it("refuses a provider that is not one of ours", async () => {
    const res = await post(turn({ provider: "gpt5-oracle" }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONSOLE_CHAT_PROVIDER_UNAVAILABLE");
  });

  it("reports a provider failure as a provider failure, not as an arena one", async () => {
    providerThrows = new Error("upstream exploded");
    const res = await post(turn());

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("CONSOLE_CHAT_PROVIDER_ERROR");
    expect(call).not.toHaveBeenCalled();
  });

  it("never echoes a provider key, even out of a provider's own error", async () => {
    providerThrows = new Error(`401 from upstream using ${PROVIDER_KEY}`);
    const res = await post(turn());

    expect(JSON.stringify(res.body)).not.toContain(PROVIDER_KEY);
  });

  it("never echoes the wallet key", async () => {
    call.mockResolvedValue(ok({ note: `leaked ${KEY}` }));
    SCRIPT.push({ name: "dethrone_seat" });

    const res = await post(turn());
    expect(JSON.stringify(res.body)).not.toContain(KEY);
  });

  it("refuses a malformed body without reaching a provider", async () => {
    const res = await post({ kind: "turn", provider: "openrouter" });
    expect(res.status).toBe(400);
    expect(call).not.toHaveBeenCalled();
  });
});

describe("the route's own shape", () => {
  const source = read(join(SRC, "app/api/chat/route.ts"));

  it("exists where the one-fetch allowlist says it does", () => {
    expect(existsSync(join(SRC, "app/api/chat/route.ts"))).toBe(true);
  });

  it("is nodejs and dynamic — every number on this path is money-adjacent", () => {
    expect(source).toMatch(/export const runtime = "nodejs";/);
    expect(source).toMatch(/export const dynamic = "force-dynamic";/);
  });

  it("does not import the arena, the payer, or the signer", () => {
    expect(source).not.toMatch(/from "@\/lib\/arena"/);
    expect(source).not.toMatch(/from "@\/lib\/pay"/);
    expect(source).not.toMatch(/from "@\/lib\/sign"/);
  });
});

/**
 * The gap `test/one-fetch.test.ts` cannot see, closed here.
 *
 * That test walks `src/` only, so an SDK's network calls and the Claude Agent
 * SDK's subprocess spawn are structurally invisible to it — they happen inside
 * `node_modules`, where the AST scan does not reach. Two of the four providers
 * are therefore outbound surfaces that the repo's strongest architectural test
 * cannot enforce anything about.
 *
 * Import uniqueness is the substitute. It does not bound what the SDK does; it
 * bounds how many places in this repo can ask it to do anything, which is the
 * property a reviewer can actually check.
 */
describe("each SDK has exactly one call site", () => {
  const files = sourceFiles();

  /**
   * Both spellings, deliberately. `anthropic.ts` imports statically;
   * `claude-max.ts` imports dynamically, so that a deploy which cannot spawn a
   * subprocess never loads the SDK at all. A check that only understood
   * `from "…"` would have declared the second one clean while it was the one
   * that spawns processes.
   */
  function importsOf(specifier: string): string[] {
    const escaped = specifier.replace(/[/\-]/g, "\\$&");
    const re = new RegExp(`(?:from\\s+"${escaped}"|import\\("${escaped}"\\))`);
    return files.filter((f) => re.test(read(f))).map(rel);
  }

  it.each([
    ["@anthropic-ai/sdk", "lib/chat/providers/anthropic.ts"],
    ["@anthropic-ai/claude-agent-sdk", "lib/chat/providers/claude-max.ts"],
  ])("%s is reached from only one file: %s", (specifier, owner) => {
    expect(importsOf(specifier)).toEqual([owner]);
  });

  it("recognises both import spellings, or it is asserting nothing", () => {
    // Guards the regex itself. If this ever returns [], the two cases above
    // pass vacuously and the gap they exist to close is silently reopened.
    expect(importsOf("@anthropic-ai/sdk").length).toBe(1);
    expect(importsOf("@anthropic-ai/claude-agent-sdk").length).toBe(1);
  });
});
