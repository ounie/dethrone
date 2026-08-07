import { beforeEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { authMessage, resolveScope, signedHeaders } from "@/lib/sign";
import { __resetWalletCache } from "@/lib/wallet";

/**
 * The signature format.
 *
 * This is the highest-value test in the suite, because a signed read that
 * disagrees with the server by one character fails as a bare 401 with no useful
 * detail — the single most expensive way to learn that a format was guessed.
 *
 * The expected strings below are written out **by hand**, not recomputed by the
 * code under test. A test that builds its expectation with the same function it
 * is testing proves only that the function is deterministic.
 *
 * Canonical source: the arena's `wallet-auth.ts` —
 *   `dethrone:${scope}:${METHOD}:${pathname}:${timestampMs}`
 *   headers x-wallet / x-timestamp / x-signature, window ±60s, nonce single-use.
 */

const KEY = ("0x" + "b".repeat(64)) as `0x${string}`;
const ACCOUNT = privateKeyToAccount(KEY);

beforeEach(() => {
  process.env.DETHRONE_PRIVATE_KEY = KEY;
  __resetWalletCache();
});

describe("the message layout is the canon's, character for character", () => {
  it.each([
    ["stable", "GET", "/api/stable", "dethrone:stable:GET:/api/stable:1754500000000"],
    [
      "character:12",
      "DELETE",
      "/api/character/12",
      "dethrone:character:12:DELETE:/api/character/12:1754500000000",
    ],
    [
      "duel:d_abc",
      "POST",
      "/api/duel/d_abc/cancel",
      "dethrone:duel:d_abc:POST:/api/duel/d_abc/cancel:1754500000000",
    ],
    [
      "heir:7",
      "POST",
      "/api/heir/7/list",
      "dethrone:heir:7:POST:/api/heir/7/list:1754500000000",
    ],
    [
      "match:mat_9",
      "GET",
      "/api/match/mat_9",
      "dethrone:match:mat_9:GET:/api/match/mat_9:1754500000000",
    ],
  ])("scope %s", (scope, method, path, expected) => {
    expect(authMessage(scope, method, path, "1754500000000")).toBe(expected);
  });

  it("uppercases the method, because the server uppercases before comparing", () => {
    expect(authMessage("stable", "get", "/api/stable", "1")).toBe("dethrone:stable:GET:/api/stable:1");
  });

  it("uses a colon delimiter and no spaces anywhere", () => {
    expect(authMessage("stable", "GET", "/api/stable", "1")).not.toMatch(/\s/);
  });
});

describe("the header triple", () => {
  it("is named exactly x-wallet / x-timestamp / x-signature", async () => {
    const headers = await signedHeaders("stable", "GET", "/api/stable");
    expect(Object.keys(headers).sort()).toEqual(["x-signature", "x-timestamp", "x-wallet"]);
  });

  it("carries the operator's address", async () => {
    const headers = await signedHeaders("stable", "GET", "/api/stable");
    expect(headers["x-wallet"]).toBe(ACCOUNT.address);
  });

  it("uses MILLISECONDS, not seconds", async () => {
    const headers = await signedHeaders("stable", "GET", "/api/stable");
    // Seconds would be ~1.7e9; milliseconds are ~1.7e12. The server's ±60s
    // window makes a seconds-based timestamp fail as stale by 55 years.
    expect(Number(headers["x-timestamp"])).toBeGreaterThan(1e12);
  });

  it("puts the SAME string in the header and the message", async () => {
    const headers = await signedHeaders("stable", "GET", "/api/stable");
    const message = authMessage("stable", "GET", "/api/stable", headers["x-timestamp"]);
    const valid = await verifyMessage({
      address: ACCOUNT.address,
      message,
      signature: headers["x-signature"] as `0x${string}`,
    });
    expect(valid, "the signature does not verify over the message we claim to sign").toBe(true);
  });

  it("produces a signature the canon's ecrecover path will accept", async () => {
    const headers = await signedHeaders("character:12", "DELETE", "/api/character/12");
    const valid = await verifyMessage({
      address: headers["x-wallet"] as `0x${string}`,
      message: `dethrone:character:12:DELETE:/api/character/12:${headers["x-timestamp"]}`,
      signature: headers["x-signature"] as `0x${string}`,
    });
    expect(valid).toBe(true);
  });

  it("re-signs with a fresh timestamp on every call — a resent triple is a replay", async () => {
    const first = await signedHeaders("stable", "GET", "/api/stable");
    await new Promise((r) => setTimeout(r, 2));
    const second = await signedHeaders("stable", "GET", "/api/stable");
    expect(second["x-timestamp"]).not.toBe(first["x-timestamp"]);
  });

  it("throws rather than signing with no key", async () => {
    delete process.env.DETHRONE_PRIVATE_KEY;
    __resetWalletCache();
    await expect(signedHeaders("stable", "GET", "/api/stable")).rejects.toThrow("NO_WALLET");
  });
});

describe("the signed path never carries a query string", () => {
  it("a path with a query would not match what the server rebuilds", () => {
    // The server signs `new URL(req.url).pathname`, which excludes `?…`.
    // This test documents the rule; the route enforces it by passing only the
    // filled pathname and keeping query params in a separate bag.
    const withQuery = authMessage("stable", "GET", "/api/stable?limit=5", "1");
    const without = authMessage("stable", "GET", "/api/stable", "1");
    expect(withQuery).not.toBe(without);
  });
});

describe("scope templates resolve from the same args as the path", () => {
  it.each([
    ["stable", {}, "stable"],
    ["character:{id}", { id: "12" }, "character:12"],
    ["duel:{id}", { id: "d_abc" }, "duel:d_abc"],
    ["heir:{id}", { id: "7" }, "heir:7"],
    ["match:{id}", { id: "mat_9" }, "match:mat_9"],
  ])("%s", (template, args, expected) => {
    expect(resolveScope(template, args as Record<string, string>)).toBe(expected);
  });

  it("leaves nothing unresolved when an arg is missing, rather than signing a literal brace", () => {
    expect(resolveScope("character:{id}", {})).toBe("character:");
  });
});
