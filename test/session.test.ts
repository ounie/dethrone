import { beforeAll, describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  SESSION_COOKIE,
  clearCookie,
  cookieValue,
  mint,
  passwordMatches,
  sessionKey,
  setCookie,
  verify,
} from "@/lib/session";

/**
 * The token, as a table.
 *
 * This is the payoff of the `session.ts` / `auth.ts` split, and it is the same
 * payoff `assertions.ts` bought by splitting from `config.ts`: every secret
 * arrives as an argument, so there is no `process.env` to poison, no module
 * cache to reset, and no `vi.stubEnv` to leak into the next case. A clock is a
 * parameter too, which is why the expiry cases below do not have to wait thirty
 * days.
 */

const PASSWORD = "correct horse battery staple";
const OTHER = "incorrect horse battery staple";

// PBKDF2 at 210k iterations is expensive on purpose. Derived once here rather
// than per case, for the same reason `auth.ts` memoizes it per process.
let key: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  [key, otherKey] = await Promise.all([sessionKey(PASSWORD), sessionKey(OTHER)]);
});

const NOW = 1_700_000_000_000;

describe("a token this key issued verifies, and only that", () => {
  it("round-trips", async () => {
    expect(await verify(key, await mint(key, NOW), NOW)).toBe("valid");
  });

  it("is different every time, so it is never a stable identifier", async () => {
    const [a, b] = await Promise.all([mint(key, NOW), mint(key, NOW)]);
    expect(a).not.toBe(b);
    expect(await verify(key, b, NOW)).toBe("valid");
  });

  /**
   * The property the whole revocation story rests on: because the signing key is
   * derived from the password, changing the password ends every session. It is
   * asserted here rather than only claimed in prose, because it is the only
   * logout-everywhere control this design has.
   */
  it("does not verify under a different password", async () => {
    const token = await mint(key, NOW);
    expect(await verify(otherKey, token, NOW)).toBe("bad-signature");
  });

  it("fails on a forged signature", async () => {
    const token = await mint(key, NOW);
    const parts = token.split(".");
    // Flip one character of the MAC. Everything else about the token is intact,
    // so nothing but the signature check can be what catches this.
    parts[3] = parts[3][0] === "A" ? "B" + parts[3].slice(1) : "A" + parts[3].slice(1);
    expect(await verify(key, parts.join("."), NOW)).toBe("bad-signature");
  });

  /**
   * The case that matters most and is easiest to get wrong: an expiry the caller
   * edited. A token whose signature covers the expiry cannot be extended, so this
   * must read as a forgery rather than as a longer session.
   */
  it("cannot have its expiry extended", async () => {
    const token = await mint(key, NOW);
    const parts = token.split(".");
    parts[1] = String(Number(parts[1]) + 10_000_000);
    expect(await verify(key, parts.join("."), NOW)).toBe("bad-signature");
  });
});

describe("expiry", () => {
  it("rejects a token past its expiry", async () => {
    const token = await mint(key, NOW, 1000);
    expect(await verify(key, token, NOW + 999)).toBe("valid");
    expect(await verify(key, token, NOW + 1001)).toBe("expired");
  });
});

describe("malformed input is refused rather than thrown on", () => {
  const cases: [string, string | undefined | null][] = [
    ["undefined", undefined],
    ["null", null],
    ["empty", ""],
    ["no dots", "nonsense"],
    ["too few parts", "v1.123.abc"],
    ["too many parts", "v1.123.abc.def.ghi"],
    ["unknown version", "v2.99999999999999.abc.def"],
    ["non-numeric expiry", "v1.abc.def.ghi"],
    // `Number("1e999")` is Infinity, which would be an expiry that never passes.
    ["exponential expiry", "v1.1e999.abc.def"],
    ["padded expiry", "v1. 99999999999999 .abc.def"],
    ["non-base64url nonce", "v1.99999999999999.a+b/c.def"],
  ];

  for (const [name, token] of cases) {
    it(name, async () => {
      const result = await verify(key, token, NOW);
      expect(result).not.toBe("valid");
    });
  }
});

describe("passwordMatches", () => {
  it("accepts the configured password", async () => {
    expect(await passwordMatches(key, PASSWORD, PASSWORD)).toBe(true);
  });

  it("rejects a prefix, a superstring and a near miss", async () => {
    expect(await passwordMatches(key, PASSWORD.slice(0, -1), PASSWORD)).toBe(false);
    expect(await passwordMatches(key, PASSWORD + "!", PASSWORD)).toBe(false);
    expect(await passwordMatches(key, OTHER, PASSWORD)).toBe(false);
    expect(await passwordMatches(key, "", PASSWORD)).toBe(false);
  });
});

describe("cookieValue", () => {
  it("finds one cookie among several", () => {
    expect(cookieValue(`a=1; ${SESSION_COOKIE}=xyz; b=2`, SESSION_COOKIE)).toBe("xyz");
  });

  it("keeps a value containing an equals sign", () => {
    // Base64url leaves no padding, but a naive split("=") would truncate a value
    // that kept some — and the bug would be invisible until the day one did.
    expect(cookieValue(`${SESSION_COOKIE}=ab==`, SESSION_COOKIE)).toBe("ab==");
  });

  it("returns undefined for an absent cookie or header", () => {
    expect(cookieValue("a=1", SESSION_COOKIE)).toBeUndefined();
    expect(cookieValue(null, SESSION_COOKIE)).toBeUndefined();
    expect(cookieValue("", SESSION_COOKIE)).toBeUndefined();
  });

  it("does not match a cookie whose name merely ends with this one", () => {
    expect(cookieValue(`not_${SESSION_COOKIE}=xyz`, SESSION_COOKIE)).toBeUndefined();
  });
});

describe("the cookie attributes are the security properties", () => {
  it("is HttpOnly, SameSite=Strict and path-scoped", () => {
    const header = setCookie("tok", { secure: true });
    expect(header).toContain("HttpOnly");
    // SameSite=Strict is this console's CSRF story for the four spending routes.
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Path=/");
    expect(header).toContain("Secure");
  });

  it("omits Secure where the connection is not, so a local login can persist", () => {
    expect(setCookie("tok", { secure: false })).not.toContain("Secure");
  });

  it("clears with the same attributes, or the browser keeps the old one", () => {
    const header = clearCookie({ secure: true });
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("Path=/");
    expect(header).toContain("SameSite=Strict");
  });
});

describe("the minimum password length is a number somebody chose", () => {
  it("is at least twelve", () => {
    // Pinned so a future edit that lowers it is a deliberate act with a test to
    // change, rather than a one-character diff nobody reviews.
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(12);
  });
});
