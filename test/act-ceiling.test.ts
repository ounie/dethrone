import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

/**
 * PRD §6 and §11, driven through the real route handler with the network
 * stubbed:
 *
 *  - `spentCents` never increments on a non-2xx.
 *  - Exceeding the ceiling returns `CONSOLE_SPEND_CAP` **and no request leaves
 *    the process** — asserted by the stub never being called, which is the only
 *    way to assert it that cannot be satisfied by a refund.
 *  - A caller-priced command requires a confirmation regardless of amount.
 *  - The offer gate refuses above the maximum with nothing signed.
 *  - A transport failure replays the identical payload exactly once.
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

function refusal(code: string, status = 409) {
  return {
    result: {
      status,
      ok: false,
      ms: 8,
      body: { error: { code, message: "refused" } },
      interfaceVersion: "interface-v2",
      featureDisabled: false,
      settlement: null,
    },
    attempt: {},
  };
}

async function post(payload: unknown) {
  const { POST } = await import("@/app/api/act/route");
  const res = await POST(
    new Request("http://127.0.0.1:3939/api/act", {
      method: "POST",
      headers: { host: "127.0.0.1:3939", "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, never> };
}

beforeEach(async () => {
  vi.resetModules();
  call.mockReset();
  replay.mockReset();
  process.env.DETHRONE_PRIVATE_KEY = KEY;
  process.env.DETHRONE_BASE_URL = "http://127.0.0.1:3000";
  process.env.CONSOLE_MAX_SPEND_CENTS = "100";
  process.env.CONSOLE_CONFIRM_OVER_CENTS = "100";
  // Assertion 3 is live in these tests and it is right to be: with a key set
  // and no resolvable bind address, the console refuses to start. Under vitest
  // `process.argv` is the test runner's, so the bind is declared here instead.
  // Removing this line makes every case below fail with CONSOLE_MISCONFIGURED,
  // which is the assertion doing its job.
  process.env.HOST = "127.0.0.1";
  delete process.env.VERCEL;
  delete process.env.KV_REST_API_URL;
  // The spend counter lives on globalThis so a hot reload cannot unbuckle it
  // mid-sitting; each test starts a fresh sitting.
  delete (globalThis as Record<string, unknown>).__dethrone_console_spent__;
  delete (globalThis as Record<string, unknown>).__dethrone_console_rules__;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the ceiling", () => {
  it("counts a settled payment", async () => {
    call.mockResolvedValue(ok());
    const first = await post({ id: "forge" });
    expect(first.body.ceiling).toMatchObject({ enabled: true, spentCents: 10, cap: 100 });
  });

  it("refuses past the cap, and NO request leaves the process", async () => {
    call.mockResolvedValue(ok());
    // 100¢ cap, 100¢ challenge → the first fits exactly, the second cannot.
    await post({ id: "challenge", args: { characterId: "1" }, confirm: { amountCents: 100, payer: addr() } });
    call.mockClear();

    const second = await post({
      id: "challenge",
      args: { characterId: "1" },
      confirm: { amountCents: 100, payer: addr() },
    });

    expect(second.status).toBe(429);
    expect(second.body.error).toMatchObject({ code: "CONSOLE_SPEND_CAP" });
    expect(call, "a request left the process after the ceiling refused").not.toHaveBeenCalled();
  });

  it("a 409 leaves spentCents unchanged — a refusal costs nothing", async () => {
    // Room for both commands: this test is about what a refusal costs, and a
    // ceiling tight enough to refuse the second one first would never reach the
    // 409 it is here to check.
    process.env.CONSOLE_MAX_SPEND_CENTS = "500";
    call.mockResolvedValueOnce(ok());
    const settled = await post({ id: "forge" });
    expect(settled.body.ceiling).toMatchObject({ spentCents: 10 });

    call.mockResolvedValueOnce(refusal("SEAT_VESTING"));
    const refused = await post({
      id: "challenge",
      args: { characterId: "1" },
      confirm: { amountCents: 100, payer: addr() },
    });

    expect(refused.body.status).toBe(409);
    expect(refused.body.ceiling, "the seatbelt tightened on a refusal").toMatchObject({
      spentCents: 10,
    });
  });

  it("renders the canon's code, not prose", async () => {
    call.mockResolvedValue(refusal("SEAT_VESTING"));
    const res = await post({
      id: "challenge",
      args: { characterId: "1" },
      confirm: { amountCents: 100, payer: addr() },
    });
    expect(JSON.stringify(res.body)).toContain("SEAT_VESTING");
  });
});

describe("the confirmation is enforced server-side", () => {
  it("refuses a caller-priced command with no confirmation, however small", async () => {
    call.mockResolvedValue(ok());
    const res = await post({
      id: "post_duel",
      args: { characterId: "1", arenaSlug: "a", stake: "1" },
    });
    expect(res.status).toBe(428);
    expect(res.body.error).toMatchObject({ code: "CONSOLE_CONFIRM_REQUIRED" });
    expect(call).not.toHaveBeenCalled();
  });

  it("names the amount and the payer so the dialog cannot invent them", async () => {
    call.mockResolvedValue(ok());
    const res = await post({
      id: "post_duel",
      args: { characterId: "1", arenaSlug: "a", stake: "42" },
    });
    expect((res.body.error as unknown as { detail: Record<string, unknown> }).detail).toMatchObject({
      amountCents: 42,
      payer: addr(),
      callerPriced: true,
    });
  });

  it("refuses an echo that does not match what the server computed", async () => {
    call.mockResolvedValue(ok());
    const res = await post({
      id: "post_duel",
      args: { characterId: "1", arenaSlug: "a", stake: "42" },
      confirm: { amountCents: 1, payer: addr() },
    });
    expect(res.status).toBe(428);
    expect(call).not.toHaveBeenCalled();
  });

  it("proceeds on a matching echo", async () => {
    call.mockResolvedValue(ok());
    const res = await post({
      id: "post_duel",
      args: { characterId: "1", arenaSlug: "a", stake: "42" },
      confirm: { amountCents: 42, payer: addr() },
    });
    expect(res.body.status).toBe(200);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("requires a confirmation before destroying a fighter", async () => {
    call.mockResolvedValue(ok());
    const res = await post({ id: "release", args: { id: "12" } });
    expect(res.status).toBe(428);
    expect(call).not.toHaveBeenCalled();
  });
});

describe("refusals that never reach the network", () => {
  it("an empty required :segment", async () => {
    const res = await post({ id: "character", args: {} });
    expect(res.body.error).toMatchObject({ code: "CONSOLE_MISSING_FIELD" });
    expect(call).not.toHaveBeenCalled();
  });

  it("an unknown command", async () => {
    const res = await post({ id: "not_a_command" });
    expect(res.body.error).toMatchObject({ code: "CONSOLE_UNKNOWN_COMMAND" });
    expect(call).not.toHaveBeenCalled();
  });

  it("genesis is unregistered without the opt-in", async () => {
    const res = await post({ id: "buy_genesis", args: { houseSlug: "x" } });
    expect(res.body.error).toMatchObject({ code: "CONSOLE_COMMAND_DISABLED" });
    expect(call).not.toHaveBeenCalled();
  });

  it("a paid command with no key", async () => {
    delete process.env.DETHRONE_PRIVATE_KEY;
    vi.resetModules();
    const res = await post({ id: "forge" });
    expect(res.body.error).toMatchObject({ code: "CONSOLE_NO_WALLET" });
    expect(call).not.toHaveBeenCalled();
  });
});

describe("the offer gate", () => {
  it("reports CONSOLE_PRICE_ABOVE_MAX and does not count the spend", async () => {
    call.mockResolvedValue({
      result: {
        status: 402,
        ok: false,
        ms: 5,
        body: null,
        interfaceVersion: "interface-v2",
        featureDisabled: false,
        settlement: null,
      },
      attempt: { refusedOffer: { quotedCents: 900, maxCents: 50 } },
    });

    const res = await post({
      id: "take_duel",
      args: { id: "d1", characterId: "1", maxCents: "50" },
      confirm: { amountCents: 50, payer: addr() },
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "CONSOLE_PRICE_ABOVE_MAX" });
  });
});

describe("the single permitted retry", () => {
  it("replays the identical payload exactly once and never re-signs", async () => {
    call.mockResolvedValue({
      result: null,
      attempt: { capturedSignature: "PAYLOAD" },
      transportError: new Error("ECONNRESET"),
    });
    replay.mockResolvedValue(ok());

    const res = await post({ id: "forge" });

    expect(call).toHaveBeenCalledTimes(1);
    expect(replay).toHaveBeenCalledTimes(1);
    expect(replay.mock.calls[0][1], "the replay must resend the captured payload").toBe("PAYLOAD");
    expect(res.body.status).toBe(200);
  });

  it("reports CONSOLE_PAYMENT_INFLIGHT when the replay also fails", async () => {
    call.mockResolvedValue({
      result: null,
      attempt: { capturedSignature: "PAYLOAD" },
      transportError: new Error("ECONNRESET"),
    });
    replay.mockResolvedValue({ result: null, attempt: {}, transportError: new Error("again") });

    const res = await post({ id: "forge" });
    expect(res.body.error).toMatchObject({ code: "CONSOLE_PAYMENT_INFLIGHT" });
    expect(replay).toHaveBeenCalledTimes(1);
  });

  it("does not replay when nothing was ever signed", async () => {
    call.mockResolvedValue({
      result: null,
      attempt: {},
      transportError: new Error("ENOTFOUND"),
    });
    const res = await post({ id: "seat" });
    expect(replay).not.toHaveBeenCalled();
    expect(res.body.error).toMatchObject({ code: "CONSOLE_TRANSPORT" });
  });
});

describe("the envelope", () => {
  it("reports settled from the receipt, not from res.ok", async () => {
    call.mockResolvedValue({
      result: {
        status: 200,
        ok: true,
        ms: 4,
        body: {},
        interfaceVersion: "interface-v2",
        featureDisabled: false,
        settlement: null, // the dev bypass produces no receipt
      },
      attempt: {},
    });
    const res = await post({ id: "forge" });
    expect(res.body.settled, "a settlement the arena did not report did not happen").toBe(false);
  });

  it("carries no signature or payment value anywhere", async () => {
    call.mockResolvedValue(ok({ signature: "0x" + "ab".repeat(65) }));
    const res = await post({ id: "forge" });
    expect(JSON.stringify(res.body)).not.toContain("ab".repeat(65));
  });

  it("never contains the private key", async () => {
    call.mockResolvedValue(ok({ echo: KEY }));
    const res = await post({ id: "forge" });
    expect(JSON.stringify(res.body)).not.toContain(KEY);
  });
});

/**
 * The address the fixture key derives to.
 *
 * Derived, never hard-coded: the confirmation echo must match the payer the
 * *route* computed, so a stale literal here would make these tests pass for the
 * wrong reason — or fail for one that has nothing to do with the ceiling.
 */
function addr(): string {
  return privateKeyToAccount(KEY as `0x${string}`).address;
}
