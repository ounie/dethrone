import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Switching which wallet signs.
 *
 * Two cases here are the reason the file exists, and they pull in opposite
 * directions.
 *
 * **The switch works**: a signed command really is signed by the wallet the
 * dropdown names. Without that the feature is a label that changes colour.
 *
 * **The switch cannot launder the ceiling**: the spend counter is sitting-wide,
 * so selecting a different wallet does not hand you a fresh budget. That was
 * the obvious way to implement this and it turns a seatbelt into a dropdown
 * you can unbuckle, so it gets a regression test rather than a comment.
 *
 * The rest is the same argument `ceiling-route.test.ts` makes about being a
 * second route at all: nothing reaches the canon, nothing is signed, nothing
 * key-shaped comes back.
 */

const KEY_A = "0x" + "a".repeat(64);
const KEY_B = "0x" + "b".repeat(64);

/**
 * The addresses the fixture keys derive to.
 *
 * Derived, never hard-coded — the same argument `act-ceiling.test.ts` makes
 * about its own: a stale literal here would make the switch cases pass for the
 * wrong reason.
 */
const addrA = () => privateKeyToAccount(KEY_A as `0x${string}`).address;
const addrB = () => privateKeyToAccount(KEY_B as `0x${string}`).address;

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
    features: { duels: true, court: true },
    arena: null,
    fetchedAt: 0,
  }),
}));

function ok(body: unknown = { ok: true }) {
  return {
    result: {
      status: 200,
      ok: true,
      ms: 12,
      body,
      interfaceVersion: "interface-v2",
      featureDisabled: false,
      settlement: { success: true, payer: "0x1", transaction: "0x2" },
    },
    attempt: {},
  };
}

async function switchTo(id: unknown, host = "127.0.0.1:3939") {
  const { POST } = await import("@/app/api/wallet/route");
  const res = await POST(
    new Request("http://127.0.0.1:3939/api/wallet", {
      method: "POST",
      headers: { host, "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, never> };
}

async function act(payload: unknown) {
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

async function signingAs(): Promise<string | null> {
  const { address } = await import("@/lib/wallet");
  return address();
}

beforeEach(() => {
  vi.resetModules();
  call.mockReset();
  replay.mockReset();
  process.env.DETHRONE_PRIVATE_KEY = KEY_A;
  process.env.DETHRONE_PRIVATE_KEY_SCRAPYARD = KEY_B;
  process.env.DETHRONE_BASE_URL = "http://127.0.0.1:3000";
  process.env.CONSOLE_MAX_SPEND_CENTS = "500";
  process.env.CONSOLE_CONFIRM_OVER_CENTS = "100";
  // Assertion 3 is live here, as in every route test: with a key set and no
  // resolvable bind address the console refuses to start.
  process.env.HOST = "127.0.0.1";
  delete process.env.VERCEL;
  delete process.env.CONSOLE_ALLOW_REMOTE;
  delete process.env.KV_REST_API_URL;
  delete (globalThis as Record<string, unknown>).__dethrone_console_spent__;
  delete (globalThis as Record<string, unknown>).__dethrone_console_rules__;
  delete (globalThis as Record<string, unknown>).__dethrone_console_wallet__;
  delete (globalThis as Record<string, unknown>).__dethrone_console_autonomy__;
});

afterEach(() => {
  delete process.env.DETHRONE_PRIVATE_KEY_SCRAPYARD;
  delete (globalThis as Record<string, unknown>).__dethrone_console_wallet__;
  vi.restoreAllMocks();
});

describe("the switch actually moves who signs", () => {
  it("a signed command carries the new wallet's x-wallet header", async () => {
    call.mockResolvedValue(ok());

    await act({ id: "court_proclaim", args: { anchorKind: "seat", title: "t", body: "b" } });
    expect(call.mock.calls[0][0].headers["x-wallet"]).toBe(addrA());

    const res = await switchTo("scrapyard");
    expect(res.status).toBe(200);
    expect(res.body.selected).toMatchObject({ id: "scrapyard", address: addrB() });

    call.mockClear();
    await act({ id: "court_proclaim", args: { anchorKind: "seat", title: "t", body: "b" } });
    expect(call.mock.calls[0][0].headers["x-wallet"]).toBe(addrB());
  });

  it("lists every configured wallet, and says which one is selected", async () => {
    const res = await switchTo("scrapyard");
    expect((res.body.wallets as unknown as { label: string }[]).map((w) => w.label)).toEqual([
      "Primary",
      "Scrapyard",
    ]);
    expect(res.body.selectedId).toBe("scrapyard");
  });
});

describe("the switch cannot launder the ceiling", () => {
  it("spentCents survives a wallet switch — the counter is per SITTING", async () => {
    call.mockResolvedValue(ok());

    const spent = await act({ id: "forge" });
    expect(spent.body.ceiling).toMatchObject({ spentCents: 10 });

    await switchTo("scrapyard");

    // The whole reason `spend.ts` stopped keying on the operator's address. If
    // this ever reads 0 again, N wallets means N times the ceiling and the
    // dropdown is the way to unbuckle it.
    const after = await act({ id: "forge" });
    expect(after.body.ceiling).toMatchObject({ spentCents: 20 });
  });

  it("says nothing about money at all", async () => {
    const res = await switchTo("scrapyard");
    expect(JSON.stringify(res.body)).not.toMatch(/cents|cap|spent|ceiling/i);
  });
});

describe("what it refuses", () => {
  it("409s an id no configured wallet has, and nothing moves", async () => {
    const res = await switchTo("nope");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "CONSOLE_UNKNOWN_WALLET" });
    expect(await signingAs()).toBe(addrA());
  });

  it("400s a malformed body", async () => {
    const res = await switchTo(42);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "CONSOLE_BAD_FIELD" });
    expect(await signingAs()).toBe(addrA());
  });

  it("400s when this deploy holds no key", async () => {
    vi.resetModules();
    delete process.env.DETHRONE_PRIVATE_KEY;
    delete process.env.DETHRONE_PRIVATE_KEY_SCRAPYARD;
    const res = await switchTo("primary");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "CONSOLE_NO_WALLET" });
  });

  it("403s off loopback — the blast radius is every wallet, not just one", async () => {
    const res = await switchTo("scrapyard", "console.example.com");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: "CONSOLE_REMOTE_HOST" });
    expect(await signingAs()).toBe(addrA());
  });
});

describe("it is not a second door to the canon", () => {
  it("makes no request to the arena at all", async () => {
    await switchTo("scrapyard");
    await switchTo("primary");
    await switchTo("nope");
    expect(call, "the switch route reached the arena").not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
  });

  it("returns nothing key-shaped", async () => {
    const res = await switchTo("scrapyard");
    const wire = JSON.stringify(res.body);
    expect(wire).not.toContain(KEY_A);
    expect(wire).not.toContain(KEY_B);
    // Addresses are 40 hex characters and must survive; a key is 64.
    expect(wire).not.toMatch(/0x[0-9a-fA-F]{64}/);
    expect(wire).toContain(addrB());
  });
});
