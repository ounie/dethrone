import { describe, expect, it } from "vitest";
import { assertConsoleConfig, isLoopbackHost, resolveKvRest } from "@/lib/assertions";

/**
 * PRD §9's seven startup assertions, as a table.
 *
 * This is possible only because `assertConsoleConfig` is pure: no process to
 * poison, no module cache to reset, no `vi.stubEnv` to leak into the next case.
 * That was the reason for splitting it from `config.ts`, and this file is the
 * payoff.
 */

const KEY = "0x" + "a".repeat(64);
const LOOPBACK = "127.0.0.1";

function codes(env: Record<string, string | undefined>, host: string | null = LOOPBACK) {
  return assertConsoleConfig(env, host)
    .filter((f) => f.level === "fail")
    .map((f) => f.code);
}

function warnings(env: Record<string, string | undefined>, host: string | null = LOOPBACK) {
  return assertConsoleConfig(env, host)
    .filter((f) => f.level === "warn")
    .map((f) => f.code);
}

describe("1 — the key parses at boot, not at settle", () => {
  it("accepts a well-formed key", () => {
    expect(codes({ DETHRONE_PRIVATE_KEY: KEY })).toEqual([]);
  });

  it.each([
    ["too short", "0x" + "a".repeat(63)],
    ["too long", "0x" + "a".repeat(65)],
    ["no 0x prefix", "a".repeat(64)],
    ["not hex", "0x" + "z".repeat(64)],
    ["a mnemonic pasted by mistake", "witch collapse practice feed shame open despair"],
  ])("refuses a key that is %s", (_label, key) => {
    expect(codes({ DETHRONE_PRIVATE_KEY: key })).toContain("CONSOLE_BAD_KEY");
  });

  it("no key at all is the supported default, not a failure", () => {
    expect(codes({})).toEqual([]);
  });
});

describe("2 — the ceiling is above the confirmation threshold", () => {
  it("accepts cap >= confirm", () => {
    expect(
      codes({ CONSOLE_MAX_SPEND_CENTS: "500", CONSOLE_CONFIRM_OVER_CENTS: "100" }),
    ).toEqual([]);
  });

  it("accepts them equal", () => {
    expect(codes({ CONSOLE_MAX_SPEND_CENTS: "100", CONSOLE_CONFIRM_OVER_CENTS: "100" })).toEqual([]);
  });

  it("refuses cap < confirm — the ceiling would refuse what the confirmation guards", () => {
    expect(
      codes({ CONSOLE_MAX_SPEND_CENTS: "50", CONSOLE_CONFIRM_OVER_CENTS: "100" }),
    ).toContain("CONSOLE_CAP_BELOW_CONFIRM");
  });

  it("refuses a non-integer cap", () => {
    expect(codes({ CONSOLE_MAX_SPEND_CENTS: "5.5" })).toContain("CONSOLE_BAD_CAP");
  });

  it("refuses a negative cap", () => {
    expect(codes({ CONSOLE_MAX_SPEND_CENTS: "-1" })).toContain("CONSOLE_BAD_CAP");
  });
});

describe("3 — a key off loopback needs an explicit acknowledgement", () => {
  it("allows a key on loopback", () => {
    expect(codes({ DETHRONE_PRIVATE_KEY: KEY }, "127.0.0.1")).toEqual([]);
  });

  it.each(["localhost", "::1", "[::1]", "127.0.0.1:3939", "127.1.1.1"])(
    "treats %s as loopback",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each(["0.0.0.0", "192.168.1.9", "example.com", ""])("treats %s as remote", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });

  it("refuses a key bound to 0.0.0.0", () => {
    expect(codes({ DETHRONE_PRIVATE_KEY: KEY }, "0.0.0.0")).toContain("CONSOLE_NOT_LOOPBACK");
  });

  it.each(["192.168.1.9", "0.0.0.0:3939", "example.com"])(
    "refuses a key bound to %s",
    (h) => {
      expect(codes({ DETHRONE_PRIVATE_KEY: KEY }, h)).toContain("CONSOLE_NOT_LOOPBACK");
    },
  );

  /**
   * The regression this file exists for.
   *
   * `instrumentation.ts` runs in a child process whose argv does not carry the
   * `--hostname` the operator passed, so the bind is UNKNOWN on the normal dev
   * path. Refusing on unknown made `pnpm dev` with a key set impossible to
   * start — a hard failure on the documented, safe path.
   *
   * Unknown is a warning. The per-request gate in `/api/act` is the
   * enforcement, and it reads a Host that actually exists.
   */
  it("does NOT refuse when the bind cannot be determined", () => {
    expect(codes({ DETHRONE_PRIVATE_KEY: KEY }, null)).toEqual([]);
  });

  it("warns instead, naming where the real check happens", () => {
    const found = assertConsoleConfig({ DETHRONE_PRIVATE_KEY: KEY }, null);
    const bind = found.find((f) => f.code === "CONSOLE_BIND_UNKNOWN");
    expect(bind?.level).toBe("warn");
    expect(bind?.message).toMatch(/per request/i);
  });

  it("is silent once HOST declares loopback, as the dev script does", () => {
    expect(assertConsoleConfig({ DETHRONE_PRIVATE_KEY: KEY }, "127.0.0.1")).toEqual([]);
  });

  it("does not warn about an unknown bind with no key — nothing can spend", () => {
    expect(warnings({}, null)).toEqual([]);
  });

  it("allows it once the operator says so", () => {
    expect(
      codes({ DETHRONE_PRIVATE_KEY: KEY, CONSOLE_ALLOW_REMOTE: "true" }, "0.0.0.0"),
    ).toEqual([]);
  });

  it("does not fire without a key — a keyless deploy has nothing to spend", () => {
    expect(codes({}, "0.0.0.0")).toEqual([]);
  });
});

describe("4 — a key on a Vercel preview", () => {
  const preview = { VERCEL: "1", VERCEL_ENV: "preview" };

  it("refuses, because previews inherit environment variables", () => {
    expect(codes({ ...preview, DETHRONE_PRIVATE_KEY: KEY }, null)).toContain("CONSOLE_PREVIEW_KEY");
  });

  it("allows a keyless preview — that is the spectator deploy", () => {
    expect(codes(preview, null)).toEqual([]);
  });

  it("allows it with the explicit flag", () => {
    expect(
      codes({ ...preview, DETHRONE_PRIVATE_KEY: KEY, CONSOLE_ALLOW_PREVIEW_KEY: "true" }, null),
    ).toEqual([]);
  });

  it("also fires on a development VERCEL_ENV", () => {
    expect(
      codes({ VERCEL: "1", VERCEL_ENV: "development", DETHRONE_PRIVATE_KEY: KEY }, null),
    ).toContain("CONSOLE_PREVIEW_KEY");
  });
});

describe("5 — a key on Vercel production without protection", () => {
  const prod = { VERCEL: "1", VERCEL_ENV: "production" };

  it("refuses: a URL anyone can reach that can spend a wallet", () => {
    expect(codes({ ...prod, DETHRONE_PRIVATE_KEY: KEY }, null)).toContain("CONSOLE_NO_PROTECTION");
  });

  it("allows a keyless production deploy — nothing to protect", () => {
    expect(codes(prod, null)).toEqual([]);
  });

  it("allows it once protection is acknowledged", () => {
    expect(
      codes({ ...prod, DETHRONE_PRIVATE_KEY: KEY, CONSOLE_PROTECTION_CONFIRMED: "true" }, null),
    ).toEqual([]);
  });

  it("does not double-fire with the preview assertion", () => {
    const failures = codes({ ...prod, DETHRONE_PRIVATE_KEY: KEY }, null);
    expect(failures).not.toContain("CONSOLE_PREVIEW_KEY");
  });
});

describe("6 — no NEXT_PUBLIC_ variable holds a secret", () => {
  it("refuses a key under a public prefix", () => {
    expect(codes({ NEXT_PUBLIC_WALLET: KEY })).toContain("CONSOLE_PUBLIC_SECRET");
  });

  it("refuses a signature under a public prefix", () => {
    expect(codes({ NEXT_PUBLIC_PROOF: "0x" + "ab".repeat(65) })).toContain(
      "CONSOLE_PUBLIC_SECRET",
    );
  });

  it("allows a public address — that is exactly what the browser may know", () => {
    expect(codes({ NEXT_PUBLIC_ADDRESS: "0x" + "a".repeat(40) })).toEqual([]);
  });

  it("scans the whole env, not a fixed list of names", () => {
    expect(codes({ NEXT_PUBLIC_SOMETHING_NOBODY_ANTICIPATED: KEY })).toContain(
      "CONSOLE_PUBLIC_SECRET",
    );
  });

  it("ignores a key that is NOT public-prefixed", () => {
    expect(codes({ DETHRONE_PRIVATE_KEY: KEY })).not.toContain("CONSOLE_PUBLIC_SECRET");
  });
});

describe("7 — serverless without a shared store warns, and never fails", () => {
  const prod = {
    VERCEL: "1",
    VERCEL_ENV: "production",
    DETHRONE_PRIVATE_KEY: KEY,
    CONSOLE_PROTECTION_CONFIRMED: "true",
  };

  it("warns that the ceiling cannot bound a sitting", () => {
    expect(warnings(prod, null)).toContain("CONSOLE_CEILING_DISABLED");
    expect(codes(prod, null)).toEqual([]);
  });

  it("is silent once a REST KV is configured", () => {
    expect(
      warnings({ ...prod, KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "t" }, null),
    ).toEqual([]);
  });

  it("warns separately about a redis:// URL, which is the wrong client shape here", () => {
    expect(warnings({ ...prod, KV_URL: "redis://x" }, null)).toContain("CONSOLE_KV_WRONG_SHAPE");
  });

  it("accepts an https KV_URL as an alias", () => {
    expect(
      resolveKvRest({ KV_URL: "https://kv.example", KV_REST_API_TOKEN: "t" }),
    ).toEqual({ url: "https://kv.example", token: "t" });
  });

  it("does not accept a redis:// KV_URL as an alias", () => {
    expect(resolveKvRest({ KV_URL: "redis://x", KV_REST_API_TOKEN: "t" })).toBeNull();
  });

  it("does not warn about the ceiling on a keyless deploy — there is nothing to bound", () => {
    expect(warnings({ VERCEL: "1", VERCEL_ENV: "production" }, null)).toEqual([]);
  });
});

describe("a fresh clone with no configuration at all starts", () => {
  it("produces neither failures nor warnings", () => {
    expect(assertConsoleConfig({}, "127.0.0.1")).toEqual([]);
  });
});
