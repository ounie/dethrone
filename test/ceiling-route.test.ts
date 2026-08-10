import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The ceiling can be tightened from the UI, and can never be loosened.
 *
 * This is the whole safety argument for adding a second client→server route to
 * an app whose claim is that it has one. `/api/act` is the only path to the
 * canon; this one makes no outbound request at all and the single thing it can
 * do to the world is make the console *less* able to spend. If that ever stops
 * being true, this file fails.
 */

const KEY = "0x" + "d".repeat(64);

async function post(capCents: unknown) {
  const { POST } = await import("@/app/api/ceiling/route");
  const res = await POST(
    new Request("http://127.0.0.1:3939/api/ceiling", {
      method: "POST",
      headers: { host: "127.0.0.1:3939", "content-type": "application/json" },
      body: JSON.stringify({ capCents }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, never> };
}

async function currentCap(): Promise<number> {
  const { spendStore } = await import("@/lib/spend");
  return spendStore().cap();
}

beforeEach(() => {
  vi.resetModules();
  process.env.DETHRONE_PRIVATE_KEY = KEY;
  process.env.CONSOLE_MAX_SPEND_CENTS = "500";
  process.env.CONSOLE_CONFIRM_OVER_CENTS = "100";
  process.env.HOST = "127.0.0.1";
  delete process.env.VERCEL;
  delete process.env.KV_REST_API_URL;
  delete (globalThis as Record<string, unknown>).__dethrone_console_spent__;
});

describe("the ceiling only tightens", () => {
  it("lowers when asked for less", async () => {
    const res = await post(200);
    expect(res.body.ceiling).toMatchObject({ enabled: true, cap: 200 });
    expect(res.body.changed).toBe(true);
    expect(await currentCap()).toBe(200);
  });

  it("IGNORES a request to raise it above the configured cap", async () => {
    const res = await post(100_000);
    expect((res.body.ceiling as unknown as { cap: number }).cap).toBe(500);
    expect(res.body.changed).toBe(false);
    expect(await currentCap()).toBe(500);
  });

  it("ignores a request to raise it back after a tightening", async () => {
    await post(150);
    expect(await currentCap()).toBe(150);

    const res = await post(400);
    expect((res.body.ceiling as unknown as { cap: number }).cap).toBe(150);
    expect(res.body.changed).toBe(false);
    expect(await currentCap(), "the ceiling was loosened").toBe(150);
  });

  it("says so, rather than silently doing nothing", async () => {
    const res = await post(100_000);
    expect(String(res.body.note)).toMatch(/only tightens/i);
    expect(String(res.body.note)).toMatch(/CONSOLE_MAX_SPEND_CENTS/);
  });

  it("refuses a non-positive or non-integer cap", async () => {
    for (const bad of [0, -5, 1.5, "200", null]) {
      const res = await post(bad);
      expect(res.status, `accepted ${String(bad)}`).toBe(400);
    }
  });

  it("refuses to pretend when the ceiling is disabled", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.CONSOLE_PROTECTION_CONFIRMED = "true";
    vi.resetModules();

    const res = await post(200);
    expect(res.body.error).toMatchObject({ code: "CONSOLE_CEILING_DISABLED" });

    delete process.env.VERCEL_ENV;
    delete process.env.CONSOLE_PROTECTION_CONFIRMED;
  });
});

describe("a tightened ceiling actually binds", () => {
  it("refuses a reservation above the new cap", async () => {
    await post(120);
    const { spendStore } = await import("@/lib/spend");
    const store = spendStore();

    expect(await store.reserve(100)).toMatchObject({ ok: true });
    // 100 + 100 = 200 > 120: the tightened cap, not the configured 500.
    expect(await store.reserve(100)).toMatchObject({ ok: false, cap: 120 });
  });
});
