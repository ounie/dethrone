import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The grant that lets a machine spend.
 *
 * Two things are being pinned here, and only one of them is the happy path.
 *
 * The first is that the handshake works: a challenge names terms the server
 * computed, an unchanged echo mints a grant, and the grant expires.
 *
 * The second is every way it must *fail closed* — a nonce that was never
 * minted, a nonce used twice, terms that changed underneath the operator, a
 * deploy where the ceiling cannot bind. Those are the tests that matter, because
 * the happy path is the one a reader will assume works and the failures are the
 * ones a refactor silently deletes.
 */

const KEY = "0x" + "a".repeat(64);
const OPERATOR = "0x8fd379246834eac74b8419ffda202cf8051f7a03";

async function load(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) vi.stubEnv(k, "");
    else vi.stubEnv(k, v);
  }
  const mod = await import("@/lib/chat/autonomy");
  mod.__resetAutonomy();
  return mod;
}

/** The configuration in which autonomy is genuinely offerable: local, keyed, opted in. */
const ENABLED = {
  DETHRONE_PRIVATE_KEY: KEY,
  CONSOLE_ALLOW_FULL_AUTONOMY: "true",
  HOST: "127.0.0.1",
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("what makes a grant offerable at all", () => {
  it("is not offerable without the env opt-in, and says so", async () => {
    const { autonomyStore } = await load({ DETHRONE_PRIVATE_KEY: KEY, HOST: "127.0.0.1" });
    const store = autonomyStore(OPERATOR);
    expect(store.offerable).toBe(false);
    expect(store.reason).toContain("CONSOLE_ALLOW_FULL_AUTONOMY");
  });

  it("is not offerable with no wallet — there is nothing to sign with", async () => {
    const { autonomyStore } = await load({
      CONSOLE_ALLOW_FULL_AUTONOMY: "true",
      HOST: "127.0.0.1",
    });
    const store = autonomyStore(null);
    expect(store.offerable).toBe(false);
    expect(store.reason).toContain("Read-only");
  });

  it("is not offerable on a serverless deploy", async () => {
    // Note what is actually doing the work here, because it is NOT the ceiling
    // clause in `autonomyStore`. That clause is unreachable: the ceiling is only
    // disabled on serverless-without-KV, and assertion 9 refuses to boot when
    // full autonomy is set alongside a key there — so the case never arrives.
    // What this pins is that a serverless deploy cannot offer autonomy by SOME
    // route, and the routes are: no boot with a key, no wallet without one.
    const { autonomyStore } = await load({
      ...ENABLED,
      DETHRONE_PRIVATE_KEY: undefined,
      VERCEL: "1",
      VERCEL_ENV: "production",
    });
    expect(autonomyStore(null).offerable).toBe(false);
  });

  it("refuses to BOOT at all with a key and full autonomy on serverless", async () => {
    // The real guard, in the place it actually lives. If this ever stops
    // throwing, the unreachable ceiling clause in autonomyStore becomes the only
    // thing standing between a hosted URL and an agent that can spend.
    vi.resetModules();
    vi.stubEnv("DETHRONE_PRIVATE_KEY", KEY);
    vi.stubEnv("CONSOLE_ALLOW_FULL_AUTONOMY", "true");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("CONSOLE_PROTECTION_CONFIRMED", "true");

    const { config } = await import("@/lib/config");
    expect(() => config()).toThrow(/CONSOLE_AUTONOMY_REMOTE/);
  });

  it("refuses to mint a challenge when it is not offerable", async () => {
    const { autonomyStore } = await load({ DETHRONE_PRIVATE_KEY: KEY, HOST: "127.0.0.1" });
    expect(() => autonomyStore(OPERATOR).challenge(500)).toThrow();
  });

  it("is offerable locally, with a key and the opt-in", async () => {
    const { autonomyStore } = await load(ENABLED);
    expect(autonomyStore(OPERATOR).offerable).toBe(true);
  });
});

describe("the handshake", () => {
  it("starts in reads mode with no grant", async () => {
    const { autonomyStore } = await load(ENABLED);
    const store = autonomyStore(OPERATOR);
    expect(store.mode()).toBe("reads");
    expect(store.read()).toBeNull();
  });

  it("names terms the server computed, not the caller", async () => {
    const { autonomyStore } = await load({ ...ENABLED, CONSOLE_AUTONOMY_MAX_CENTS: "25" });
    const challenge = autonomyStore(OPERATOR).challenge(500);

    expect(challenge.operator).toBe(OPERATOR);
    expect(challenge.perActionCapCents).toBe(25);
    expect(challenge.capCents).toBe(500);
    expect(challenge.acknowledgement).toContain(OPERATOR);
    expect(challenge.nonce).toBeTruthy();
  });

  it("mints a grant for an unchanged echo, and flips the mode", async () => {
    const { autonomyStore } = await load(ENABLED);
    const store = autonomyStore(OPERATOR);
    const c = store.challenge(500);

    const result = store.grant(
      { operator: c.operator, acknowledgement: c.acknowledgement, nonce: c.nonce },
      500,
    );

    expect(result.ok).toBe(true);
    expect(store.mode()).toBe("full");
    expect(store.read()?.perActionCapCents).toBe(c.perActionCapCents);
  });

  it("gives every challenge its own nonce", async () => {
    const { autonomyStore } = await load(ENABLED);
    const store = autonomyStore(OPERATOR);
    expect(store.challenge(500).nonce).not.toBe(store.challenge(500).nonce);
  });
});

/**
 * A grant belongs to the wallet named in the sentence the operator read.
 *
 * This was a real hole and not a hypothetical: `read()` checked the clock and
 * nothing else, so with several keys configured a grant minted while wallet A
 * was selected kept answering "full" after a switch to B — and the agent would
 * have signed and paid from an address nobody confirmed, under terms naming a
 * different one. The executor re-reads the mode on every tool call, so both
 * reads would have said yes.
 */
describe("a grant does not survive a change of operator", () => {
  const OTHER = "0x1111111111111111111111111111111111111111";

  async function granted() {
    const { autonomyStore } = await load(ENABLED);
    const store = autonomyStore(OPERATOR);
    const c = store.challenge(500);
    store.grant({ operator: c.operator, acknowledgement: c.acknowledgement, nonce: c.nonce }, 500);
    expect(store.mode()).toBe("full");
    return autonomyStore;
  }

  it("reads as no grant for a different operator", async () => {
    const autonomyStore = await granted();
    expect(autonomyStore(OTHER).read()).toBeNull();
    expect(autonomyStore(OTHER).mode()).toBe("reads");
  });

  it("is DROPPED, not shadowed — switching back does not re-arm it", async () => {
    const autonomyStore = await granted();
    autonomyStore(OTHER).read();

    // The case a refactor deletes. Returning null for the wrong operator while
    // leaving the grant in place would let a switch away and back silently
    // restore a permission the operator granted before either wallet was
    // selected — a confirmation of nothing.
    expect(autonomyStore(OPERATOR).read()).toBeNull();
    expect(autonomyStore(OPERATOR).mode()).toBe("reads");
  });
});

describe("every way it fails closed", () => {
  it("refuses a nonce it never minted", async () => {
    const { autonomyStore } = await load(ENABLED);
    const store = autonomyStore(OPERATOR);
    const c = store.challenge(500);

    const result = store.grant(
      { operator: c.operator, acknowledgement: c.acknowledgement, nonce: "invented" },
      500,
    );

    expect(result).toEqual({ ok: false, reason: "nonce" });
    expect(store.mode()).toBe("reads");
  });

  it("refuses a replayed nonce — single use, consumed on the first attempt", async () => {
    const { autonomyStore } = await load(ENABLED);
    const store = autonomyStore(OPERATOR);
    const c = store.challenge(500);
    const echo = { operator: c.operator, acknowledgement: c.acknowledgement, nonce: c.nonce };

    expect(store.grant(echo, 500).ok).toBe(true);
    store.revoke();
    expect(store.grant(echo, 500)).toEqual({ ok: false, reason: "nonce" });
    expect(store.mode()).toBe("reads");
  });

  it("burns the nonce even when the rest of the echo is wrong", async () => {
    // Otherwise one challenge is an unlimited number of attempts at guessing
    // the sentence.
    const { autonomyStore } = await load(ENABLED);
    const store = autonomyStore(OPERATOR);
    const c = store.challenge(500);

    expect(
      store.grant({ operator: c.operator, acknowledgement: "close enough", nonce: c.nonce }, 500),
    ).toEqual({ ok: false, reason: "acknowledgement" });

    expect(
      store.grant(
        { operator: c.operator, acknowledgement: c.acknowledgement, nonce: c.nonce },
        500,
      ),
    ).toEqual({ ok: false, reason: "nonce" });
  });

  it("refuses an acknowledgement the operator did not actually read", async () => {
    const { autonomyStore } = await load(ENABLED);
    const store = autonomyStore(OPERATOR);
    const c = store.challenge(500);

    expect(
      store.grant(
        { operator: c.operator, acknowledgement: c.acknowledgement + " (edited)", nonce: c.nonce },
        500,
      ),
    ).toEqual({ ok: false, reason: "acknowledgement" });
  });

  it("refuses when the ceiling was tightened between the challenge and the echo", async () => {
    // The terms in front of the operator are now stale. They get the new ones
    // and read them again — a confirmation that survives its terms changing is
    // a confirmation of nothing.
    const { autonomyStore } = await load(ENABLED);
    const store = autonomyStore(OPERATOR);
    const c = store.challenge(500);

    expect(
      store.grant(
        { operator: c.operator, acknowledgement: c.acknowledgement, nonce: c.nonce },
        100,
      ),
    ).toEqual({ ok: false, reason: "acknowledgement" });
    expect(store.mode()).toBe("reads");
  });

  it("refuses an echo naming a different payer", async () => {
    const { autonomyStore } = await load(ENABLED);
    const store = autonomyStore(OPERATOR);
    const c = store.challenge(500);

    expect(
      store.grant(
        { operator: "0xdeadbeef", acknowledgement: c.acknowledgement, nonce: c.nonce },
        500,
      ),
    ).toEqual({ ok: false, reason: "operator" });
  });

  it("lets a challenge go stale", async () => {
    vi.useFakeTimers();
    const { autonomyStore, CHALLENGE_TTL_MS } = await load(ENABLED);
    const store = autonomyStore(OPERATOR);
    const c = store.challenge(500);

    vi.advanceTimersByTime(CHALLENGE_TTL_MS + 1);

    expect(
      store.grant(
        { operator: c.operator, acknowledgement: c.acknowledgement, nonce: c.nonce },
        500,
      ),
    ).toEqual({ ok: false, reason: "nonce" });
  });
});

describe("a grant does not outlive the sitting", () => {
  it("expires, and the mode falls back to reads", async () => {
    vi.useFakeTimers();
    const { autonomyStore, AUTONOMY_TTL_MS } = await load(ENABLED);
    const store = autonomyStore(OPERATOR);
    const c = store.challenge(500);
    store.grant({ operator: c.operator, acknowledgement: c.acknowledgement, nonce: c.nonce }, 500);
    expect(store.mode()).toBe("full");

    vi.advanceTimersByTime(AUTONOMY_TTL_MS + 1);

    expect(store.mode()).toBe("reads");
    expect(store.read()).toBeNull();
  });

  it("revokes in one call, with nothing to confirm", async () => {
    // Deliberately asymmetric with granting. Restraining is one click;
    // loosening is a dialog you have to read.
    const { autonomyStore } = await load(ENABLED);
    const store = autonomyStore(OPERATOR);
    const c = store.challenge(500);
    store.grant({ operator: c.operator, acknowledgement: c.acknowledgement, nonce: c.nonce }, 500);

    store.revoke();

    expect(store.mode()).toBe("reads");
    expect(store.read()).toBeNull();
  });
});

describe("the acknowledgement is legible to the person confirming it", () => {
  it("names the payer, the per-action cap and the sitting ceiling", async () => {
    const { acknowledgementFor } = await load(ENABLED);
    const sentence = acknowledgementFor(OPERATOR, 25, 500);

    expect(sentence).toContain(OPERATOR);
    expect(sentence).toContain("$0.25");
    expect(sentence).toContain("$5.00");
    expect(sentence).toContain("without asking");
  });
});
