import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMANDS } from "@/lib/commands";

/**
 * The gate between what a model intends and what this console does.
 *
 * Driven through the REAL `/api/act` handler with only the network stubbed, so
 * every assertion below is about the actual execution path — the ceiling, the
 * 428, the host check — and not about a mock of it.
 *
 * The load-bearing assertion in this file is not any single case. It is that
 * `call` (the arena stub) is asserted **never to have been invoked** on every
 * refusal path. A test that only checked the returned event would pass just as
 * happily against an implementation that sent the request and then apologised,
 * and the difference between those two implementations is money.
 */

const KEY = "0x" + "c".repeat(64);

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

function ok(body: unknown = { ok: true }, status = 200) {
  return {
    result: {
      status,
      ok: status < 300,
      ms: 12,
      body,
      interfaceVersion: "interface-v2",
      featureDisabled: false,
      settlement: { success: true, payer: "0x1", transaction: "0x2" },
    },
    attempt: {},
  };
}

function request(host = "127.0.0.1:3939") {
  return new Request("http://127.0.0.1:3939/api/chat", {
    method: "POST",
    headers: { host, "content-type": "application/json" },
  });
}

/** Build an executor over the real modules, with every command enabled. */
async function executor(opts: { host?: string; full?: boolean } = {}) {
  const { makeExecutor } = await import("@/lib/chat/execute");
  const { autonomyStore, __resetAutonomy } = await import("@/lib/chat/autonomy");
  const { address } = await import("@/lib/wallet");

  __resetAutonomy();
  const store = autonomyStore(address());

  if (opts.full) {
    const c = store.challenge(1000);
    const granted = store.grant(
      { operator: c.operator, acknowledgement: c.acknowledgement, nonce: c.nonce },
      1000,
    );
    expect(granted.ok, "the test fixture failed to obtain a grant").toBe(true);
  }

  const capabilities = Object.fromEntries(COMMANDS.map((c) => [c.id, { enabled: true }]));

  return {
    store,
    execute: makeExecutor({
      origin: request(opts.host),
      capabilities,
      autonomy: store,
      secrets: [process.env.OPENROUTER_API_KEY ?? ""],
    }),
  };
}

const nextId = (() => {
  let n = 0;
  return () => `call_${++n}`;
})();

function toolCall(name: string, args: Record<string, unknown> = {}) {
  return { id: nextId(), name, args };
}

beforeEach(() => {
  vi.resetModules();
  call.mockReset();
  replay.mockReset();
  vi.stubEnv("DETHRONE_PRIVATE_KEY", KEY);
  vi.stubEnv("DETHRONE_BASE_URL", "http://127.0.0.1:3000");
  vi.stubEnv("CONSOLE_MAX_SPEND_CENTS", "1000");
  vi.stubEnv("CONSOLE_CONFIRM_OVER_CENTS", "1000");
  vi.stubEnv("CONSOLE_AUTONOMY_MAX_CENTS", "50");
  vi.stubEnv("CONSOLE_ALLOW_FULL_AUTONOMY", "true");
  // Assertion 3 is live here and right to be — see act-ceiling.test.ts.
  vi.stubEnv("HOST", "127.0.0.1");
  delete (globalThis as Record<string, unknown>).__dethrone_console_spent__;
  delete (globalThis as Record<string, unknown>).__dethrone_console_autonomy__;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a tool that is not a command never reaches the arena", () => {
  it("refuses an invented tool name", async () => {
    const { execute } = await executor();
    const out = await execute(toolCall("get_weather", { city: "Paris" }));

    expect(out.event).toMatchObject({ type: "refused", code: "CONSOLE_UNKNOWN_COMMAND" });
    expect(out.toolResult.isError).toBe(true);
    expect(call).not.toHaveBeenCalled();
  });

  it("refuses an argument shape no command takes", async () => {
    const { execute } = await executor();
    const out = await execute(toolCall("dethrone_derive", { address: { nested: true } }));

    expect(out.event).toMatchObject({ type: "refused", code: "CONSOLE_BAD_FIELD" });
    expect(call).not.toHaveBeenCalled();
  });

  it("refuses a command this deploy has disabled, in the deploy's own words", async () => {
    const { makeExecutor } = await import("@/lib/chat/execute");
    const { autonomyStore } = await import("@/lib/chat/autonomy");
    const { address } = await import("@/lib/wallet");

    const execute = makeExecutor({
      origin: request(),
      capabilities: { seat: { enabled: false, reason: "Duels are closed on this server." } },
      autonomy: autonomyStore(address()),
      secrets: [],
    });

    const out = await execute(toolCall("dethrone_seat"));
    expect(out.event).toMatchObject({ type: "refused", code: "CONSOLE_COMMAND_DISABLED" });
    expect(out.event).toHaveProperty("detail", "Duels are closed on this server.");
    expect(call).not.toHaveBeenCalled();
  });
});

describe("free reads execute", () => {
  it("runs a free command and reports what came back", async () => {
    call.mockResolvedValue(ok({ champion: "Rook", currentJackpotUsdc: "12.00" }));
    const { execute } = await executor();

    const out = await execute(toolCall("dethrone_seat"));

    expect(call).toHaveBeenCalledTimes(1);
    expect(out.event).toMatchObject({ type: "executed", commandId: "seat", status: 200 });
    expect(out.toolResult.content).toContain("Rook");
  });

  it("coerces a model's typed JSON onto the string wire the route expects", async () => {
    call.mockResolvedValue(ok({ actions: [] }));
    const { execute } = await executor();

    await execute(toolCall("dethrone_legal_actions", { id: 12 }));

    expect(call).toHaveBeenCalledTimes(1);
    const sent = call.mock.calls[0][0] as { path: string };
    expect(sent.path).toContain("12");
  });
});

/**
 * The pin that cannot drift.
 *
 * Written over the whole catalogue rather than over a chosen few, because the
 * failure this guards against arrives with a command nobody has written yet.
 */
describe("in reads mode, NOTHING that signs or spends reaches the arena", () => {
  const nonFree = COMMANDS.filter((c) => c.tier !== "free");

  it("has a non-trivial set to check", () => {
    expect(nonFree.length).toBeGreaterThan(5);
  });

  for (const cmd of nonFree) {
    it(`${cmd.id} (${cmd.tier}) is proposed, not executed`, async () => {
      call.mockResolvedValue(ok());
      const { execute } = await executor();

      const out = await execute(toolCall(`dethrone_${cmd.id}`, { id: "1", characterId: "1" }));

      expect(out.event.type).toBe("proposal");
      expect(out.toolResult.isError).toBeFalsy();
      expect(call, `${cmd.id} reached the arena in reads mode`).not.toHaveBeenCalled();
    });
  }
});

describe("under a grant, the arena's number is the only number", () => {
  it("executes a signed command with no confirmation dance", async () => {
    call.mockResolvedValue(ok({ characters: [] }));
    const { execute } = await executor({ full: true });

    const out = await execute(toolCall("dethrone_stable"));

    expect(out.event.type).toBe("executed");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("echoes the amount /api/act computed, and never one of its own", async () => {
    call.mockResolvedValue(ok({ duelId: 3 }, 202));
    const { execute } = await executor({ full: true });

    // A caller-priced command always 428s first, whatever the amount.
    const out = await execute(
      toolCall("dethrone_post_duel", { characterId: "1", arenaSlug: "pit", stake: "40" }),
    );

    expect(out.event).toMatchObject({ type: "executed", terms: { amountCents: 40 } });
    // Two invocations of act: one unconfirmed to learn the terms, one confirmed.
    // Exactly one request left the process, because the first was refused
    // locally before `arena.call` was reached.
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("refuses above the per-action cap with nothing signed", async () => {
    call.mockResolvedValue(ok());
    const { execute } = await executor({ full: true });

    const out = await execute(
      toolCall("dethrone_post_duel", { characterId: "1", arenaSlug: "pit", stake: "900" }),
    );

    expect(out.event).toMatchObject({ type: "refused", code: "CONSOLE_AUTONOMY_LIMIT" });
    expect(call, "a request left the process for an over-cap action").not.toHaveBeenCalled();
  });

  /**
   * The regression that a full green suite missed.
   *
   * The per-action cap was originally checked only inside the 428 branch. But
   * `/api/act` returns a 428 only above `CONSOLE_CONFIRM_OVER_CENTS` — a
   * threshold a human sets at a human's tolerance — so a paid command cheaper
   * than that executed with the executor never seeing an amount, and the cap
   * was silently not a cap for precisely the commands most likely to be run.
   *
   * Every earlier fixture set the two numbers close together, so nothing
   * caught it. The gap between them IS the test, so this one sets the human
   * threshold high and the machine's cap low, which is the realistic shape:
   * "ask me above five dollars" and "let the agent spend five cents".
   */
  it("caps a paid command whose price is BELOW the human confirmation threshold", async () => {
    vi.stubEnv("CONSOLE_CONFIRM_OVER_CENTS", "1000"); // the human: ask me above $10
    vi.stubEnv("CONSOLE_AUTONOMY_MAX_CENTS", "5"); //    the machine: 5 cents a go

    call.mockResolvedValue(ok({ characterId: 7 }, 202));
    const { execute } = await executor({ full: true });

    // Forge is priced at 10 cents by the stubbed rules: over the machine's cap,
    // far under the human's threshold.
    const out = await execute(toolCall("dethrone_forge"));

    expect(out.event).toMatchObject({ type: "refused", code: "CONSOLE_AUTONOMY_LIMIT" });
    expect(call, "a paid request left the process despite exceeding the cap").not.toHaveBeenCalled();
  });

  it("still executes a paid command that is under BOTH numbers", async () => {
    vi.stubEnv("CONSOLE_CONFIRM_OVER_CENTS", "1000");
    vi.stubEnv("CONSOLE_AUTONOMY_MAX_CENTS", "50");

    call.mockResolvedValue(ok({ characterId: 7 }, 202));
    const { execute } = await executor({ full: true });

    const out = await execute(toolCall("dethrone_forge"));

    expect(out.event).toMatchObject({ type: "executed", terms: { amountCents: 10 } });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("refuses when the grant lapsed between the 428 and the echo", async () => {
    call.mockResolvedValue(ok());
    const { execute, store } = await executor({ full: true });

    store.revoke();

    const out = await execute(
      toolCall("dethrone_post_duel", { characterId: "1", arenaSlug: "pit", stake: "10" }),
    );

    expect(out.event.type).not.toBe("executed");
    expect(call).not.toHaveBeenCalled();
  });
});

describe("what full autonomy still does not buy", () => {
  it("keeps a destructive command as a proposal", async () => {
    const destructive = COMMANDS.filter((c) => c.destructive);
    expect(destructive.length).toBeGreaterThan(0);

    call.mockResolvedValue(ok());
    const { execute } = await executor({ full: true });

    for (const cmd of destructive) {
      const out = await execute(toolCall(`dethrone_${cmd.id}`, { id: "1" }));
      expect(out.event.type, `${cmd.id} executed under full autonomy`).toBe("proposal");
    }
    expect(call).not.toHaveBeenCalled();
  });

  it("re-reads the mode on every call, so a revoke stops the very next tool", async () => {
    call.mockResolvedValue(ok({ characters: [] }));
    const { execute, store } = await executor({ full: true });

    expect((await execute(toolCall("dethrone_stable"))).event.type).toBe("executed");
    store.revoke();
    expect((await execute(toolCall("dethrone_stable"))).event.type).toBe("proposal");

    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe("the Host header is forwarded, not forged", () => {
  it("lets /api/act refuse a paid command from a host that is not loopback", async () => {
    // The test that catches a bridge which synthesised 127.0.0.1 for
    // convenience. Without it, a chat pane on a reachable deploy would be a
    // paid-command path a direct POST would have refused.
    call.mockResolvedValue(ok());
    const { execute } = await executor({ full: true, host: "evil.example" });

    const out = await execute(toolCall("dethrone_forge"));

    expect(out.event).toMatchObject({ type: "executed", errorCode: "CONSOLE_REMOTE_HOST" });
    expect(call, "a paid request left the process from a remote host").not.toHaveBeenCalled();
  });

  it("still allows a free read from anywhere — reads were never host-gated", async () => {
    call.mockResolvedValue(ok({ champion: "Rook" }));
    const { execute } = await executor({ host: "evil.example" });

    const out = await execute(toolCall("dethrone_seat"));

    expect(out.event).toMatchObject({ type: "executed", status: 200 });
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe("a tool result is an egress, and is treated as one", () => {
  it("carries no provider key, even when one is embedded in the response", async () => {
    const providerKey = "sk-ant-api03-" + "Z".repeat(48);
    vi.stubEnv("OPENROUTER_API_KEY", providerKey);

    call.mockResolvedValue(ok({ note: `upstream said ${providerKey}` }));
    const { execute } = await executor();

    const out = await execute(toolCall("dethrone_seat"));

    expect(JSON.stringify(out)).not.toContain(providerKey);
  });

  it("carries no wallet key", async () => {
    call.mockResolvedValue(ok({ note: `leaked ${KEY}` }));
    const { execute } = await executor();

    const out = await execute(toolCall("dethrone_seat"));

    expect(JSON.stringify(out)).not.toContain(KEY);
  });

  it("truncates a very large body, and says that it did", async () => {
    call.mockResolvedValue(ok({ blob: "x".repeat(40_000) }));
    const { execute } = await executor();

    const out = await execute(toolCall("dethrone_arenas"));

    expect(out.toolResult.content.length).toBeLessThan(12_000);
    expect(out.toolResult.content).toContain("truncated");
  });

  it("keeps a genome intact — it is 64 hex and it is the asset", async () => {
    const genome = "0x" + "ab".repeat(32);
    call.mockResolvedValue(ok({ character: { id: 12, genome } }));
    const { execute } = await executor();

    const out = await execute(toolCall("dethrone_character", { id: "12" }));

    expect(out.toolResult.content).toContain(genome);
  });
});
