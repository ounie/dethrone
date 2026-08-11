import { describe, expect, it } from "vitest";
import { assertConsoleConfig, isLoopbackHost, resolveKvRest } from "@/lib/assertions";

/**
 * PRD §9's startup assertions, as a table. Seven at first; ten since the agent.
 *
 * This is possible only because `assertConsoleConfig` is pure: no process to
 * poison, no module cache to reset, no `vi.stubEnv` to leak into the next case.
 * That was the reason for splitting it from `config.ts`, and this file is the
 * payoff.
 *
 * ## Read the `toEqual([])` cases as load-bearing
 *
 * A dozen cases here assert *exactly zero* findings, and they are the reason a
 * new assertion has to be gated on a variable no fixture sets. The failure mode
 * is specific and tempting: someone adds an unconditional warning — "no chat
 * provider is configured" is the natural one — a dozen unrelated tests go red
 * at once, and the cheap fix is to weaken the assertions rather than the
 * finding. Those empty arrays are what stops the boot check from acquiring
 * noise until nobody reads it.
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

/**
 * The same assertion, once several keys can be configured.
 *
 * The code stays `CONSOLE_BAD_KEY` on purpose — it is the same fault, and every
 * caller matching on it is still right. What changed is that the message has to
 * name *which* variable, because "the key is bad" is not an actionable sentence
 * when four are configured and only one of them is sixty-four hex characters.
 *
 * The duplicate warning is the only new finding in this file, and it is gated
 * structurally rather than on a flag: it cannot fire without two wallet
 * variables, and no other fixture anywhere sets a suffixed one. That is what
 * keeps the dozen `toEqual([])` cases above and below untouched.
 */
describe("1b — every configured key parses, and the finding names which one", () => {
  const OTHER = "0x" + "b".repeat(64);

  it("accepts a primary and its extras", () => {
    expect(
      codes({
        DETHRONE_PRIVATE_KEY: KEY,
        DETHRONE_PRIVATE_KEY_SCRAPYARD: OTHER,
      }),
    ).toEqual([]);
  });

  it("accepts extras with no primary — that is a supported deploy, not a mistake", () => {
    expect(codes({ DETHRONE_PRIVATE_KEY_SCRAPYARD: OTHER })).toEqual([]);
    expect(warnings({ DETHRONE_PRIVATE_KEY_SCRAPYARD: OTHER })).toEqual([]);
  });

  it("refuses a malformed extra even when the primary is fine", () => {
    const findings = assertConsoleConfig(
      { DETHRONE_PRIVATE_KEY: KEY, DETHRONE_PRIVATE_KEY_SCRAPYARD: "0xnope" },
      LOOPBACK,
    );
    const bad = findings.find((f) => f.code === "CONSOLE_BAD_KEY");
    expect(bad?.level).toBe("fail");
    // The whole point of the change: the operator is told which line to fix.
    expect(bad?.message).toContain("DETHRONE_PRIVATE_KEY_SCRAPYARD");
  });

  it("an extra alone still trips the deployment gates that a key trips", () => {
    // `hasKey` gates assertions 3, 4, 5 and 9. If it only counted the bare
    // variable, an extras-only deploy would skip every one of them.
    expect(
      codes({ DETHRONE_PRIVATE_KEY_SCRAPYARD: OTHER }, "0.0.0.0"),
    ).toContain("CONSOLE_NOT_LOOPBACK");
  });

  it("a variable set to empty is absent — not a key, not a finding", () => {
    expect(codes({ DETHRONE_PRIVATE_KEY: "", DETHRONE_PRIVATE_KEY_SCRAPYARD: "  " })).toEqual([]);
    expect(codes({ DETHRONE_PRIVATE_KEY: "" }, "0.0.0.0")).toEqual([]);
  });

  it("warns, and does not refuse, when two variables hold the same key", () => {
    const findings = assertConsoleConfig(
      { DETHRONE_PRIVATE_KEY: KEY, DETHRONE_PRIVATE_KEY_SPARE: KEY },
      LOOPBACK,
    );
    // A copy-paste is a confusing dropdown, not a hazard — the ceiling is
    // sitting-wide, so two names for one wallet costs nothing. Refusing to boot
    // over it would make the failure worse than the fault.
    expect(findings.filter((f) => f.level === "fail")).toEqual([]);
    const dupe = findings.find((f) => f.code === "CONSOLE_DUPLICATE_WALLET_KEY");
    expect(dupe?.level).toBe("warn");
    expect(dupe?.message).toContain("DETHRONE_PRIVATE_KEY_SPARE");
  });

  it("does not warn about two DIFFERENT keys, which is the whole feature", () => {
    expect(
      warnings({ DETHRONE_PRIVATE_KEY: KEY, DETHRONE_PRIVATE_KEY_SCRAPYARD: OTHER }),
    ).toEqual([]);
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

  // The agent's keys are a different shape from the wallet's, and the 0x test
  // above cannot see them. Each provider gets a specimen, because "we support
  // four providers" is exactly the kind of claim that rots.
  it.each([
    ["an Anthropic key", "sk-ant-api03-" + "A".repeat(40)],
    ["an OpenRouter key", "sk-or-v1-" + "b".repeat(48)],
    ["an OpenAI project key", "sk-proj-" + "C".repeat(40)],
    ["a bare OpenAI-shaped key", "sk-" + "d".repeat(48)],
  ])("refuses %s under a public prefix", (_label, value) => {
    expect(codes({ NEXT_PUBLIC_MODEL_KEY: value })).toContain("CONSOLE_PUBLIC_SECRET");
  });

  it("refuses a credential-NAMED public variable whatever its value looks like", () => {
    // The provider after next will have a key shape nobody here has seen. The
    // name is the part that stays honest.
    expect(codes({ NEXT_PUBLIC_SOME_VENDOR_API_KEY: "totally-inscrutable-value" })).toContain(
      "CONSOLE_PUBLIC_SECRET",
    );
  });

  it("allows a short public value under a credential-ish name — a placeholder is not a secret", () => {
    expect(codes({ NEXT_PUBLIC_API_KEY: "unset" })).toEqual([]);
  });

  it("allows an ordinary public string that merely starts with s", () => {
    expect(codes({ NEXT_PUBLIC_LABEL: "skirmish" })).toEqual([]);
  });
});

describe("8 — the per-action autonomy cap is a cap", () => {
  it("is silent when unset", () => {
    expect(assertConsoleConfig({ DETHRONE_PRIVATE_KEY: KEY }, LOOPBACK)).toEqual([]);
  });

  it("refuses a cap that is not a whole number of cents", () => {
    expect(codes({ CONSOLE_AUTONOMY_MAX_CENTS: "2.5" })).toContain("CONSOLE_BAD_AUTONOMY_CAP");
  });

  it("refuses a negative cap", () => {
    expect(codes({ CONSOLE_AUTONOMY_MAX_CENTS: "-1" })).toContain("CONSOLE_BAD_AUTONOMY_CAP");
  });

  it("refuses a per-action cap above the sitting ceiling — that is not a cap", () => {
    expect(
      codes({ CONSOLE_MAX_SPEND_CENTS: "500", CONSOLE_AUTONOMY_MAX_CENTS: "600" }),
    ).toContain("CONSOLE_AUTONOMY_ABOVE_CAP");
  });

  it("allows a per-action cap equal to the ceiling, and below it", () => {
    expect(codes({ CONSOLE_MAX_SPEND_CENTS: "500", CONSOLE_AUTONOMY_MAX_CENTS: "500" })).toEqual([]);
    expect(codes({ CONSOLE_MAX_SPEND_CENTS: "500", CONSOLE_AUTONOMY_MAX_CENTS: "25" })).toEqual([]);
  });
});

describe("9 — full autonomy is loopback-only", () => {
  it("refuses an autonomous agent on a serverless deployment holding a key", () => {
    expect(
      codes(
        {
          VERCEL: "1",
          VERCEL_ENV: "production",
          DETHRONE_PRIVATE_KEY: KEY,
          CONSOLE_PROTECTION_CONFIRMED: "true",
          CONSOLE_ALLOW_FULL_AUTONOMY: "true",
        },
        null,
      ),
    ).toContain("CONSOLE_AUTONOMY_REMOTE");
  });

  it("refuses full autonomy alongside CONSOLE_ALLOW_REMOTE", () => {
    // ALLOW_REMOTE turns off the per-request loopback check, which is the only
    // thing keeping the agent on this machine. Together they are vacuous.
    expect(
      codes({
        DETHRONE_PRIVATE_KEY: KEY,
        CONSOLE_ALLOW_REMOTE: "true",
        CONSOLE_ALLOW_FULL_AUTONOMY: "true",
      }),
    ).toContain("CONSOLE_AUTONOMY_REMOTE");
  });

  it("allows full autonomy on loopback with a key", () => {
    expect(codes({ DETHRONE_PRIVATE_KEY: KEY, CONSOLE_ALLOW_FULL_AUTONOMY: "true" })).toEqual([]);
  });

  it("says nothing on a keyless deploy — there is nothing to grant", () => {
    expect(
      assertConsoleConfig({ VERCEL: "1", CONSOLE_ALLOW_FULL_AUTONOMY: "true" }, null),
    ).toEqual([]);
  });
});

describe("10 — a named chat provider can actually run here", () => {
  it("warns when the named provider's key is absent", () => {
    expect(warnings({ CONSOLE_CHAT_PROVIDER: "openrouter" })).toContain(
      "CONSOLE_CHAT_PROVIDER_UNAVAILABLE",
    );
  });

  it("names every missing variable, not just the first", () => {
    const message = assertConsoleConfig({ CONSOLE_CHAT_PROVIDER: "openai-compatible" }, LOOPBACK)
      .map((f) => f.message)
      .join("\n");
    expect(message).toContain("OPENAI_COMPATIBLE_BASE_URL");
    expect(message).toContain("OPENAI_COMPATIBLE_API_KEY");
  });

  it("is silent once the provider is configured", () => {
    expect(
      assertConsoleConfig(
        { CONSOLE_CHAT_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-ant-api03-" + "A".repeat(40) },
        LOOPBACK,
      ),
    ).toEqual([]);
  });

  it("warns that claude-max cannot spawn a subprocess on serverless", () => {
    expect(warnings({ VERCEL: "1", CONSOLE_CHAT_PROVIDER: "claude-max" }, null)).toContain(
      "CONSOLE_CHAT_SUBPROCESS_UNAVAILABLE",
    );
  });

  it("is silent about claude-max locally — it needs no key at all", () => {
    expect(assertConsoleConfig({ CONSOLE_CHAT_PROVIDER: "claude-max" }, LOOPBACK)).toEqual([]);
  });

  it("warns about a provider it has never heard of", () => {
    expect(warnings({ CONSOLE_CHAT_PROVIDER: "gpt5-oracle" })).toContain(
      "CONSOLE_CHAT_PROVIDER_UNKNOWN",
    );
  });

  it("never fails on a chat misconfiguration — nothing here can spend", () => {
    expect(codes({ CONSOLE_CHAT_PROVIDER: "openrouter" })).toEqual([]);
    expect(codes({ CONSOLE_CHAT_PROVIDER: "gpt5-oracle" })).toEqual([]);
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

/**
 * The hosted-platform assertions.
 *
 * Every case here is gated on a variable no other fixture in this file sets —
 * `RAILWAY_ENVIRONMENT` and friends, or `CONSOLE_PASSWORD` — which is what keeps
 * the dozen `toEqual([])` cases above untouched. That constraint is the reason
 * `hostedPlatform` detects the platform rather than keying off
 * `CONSOLE_ALLOW_REMOTE`: the fixture at "accepts a remote bind when the flag is
 * set" asserts exactly zero findings, and a refusal keyed on that flag would
 * have broken it.
 */
const PASSWORD = "correct horse battery staple";
const RAILWAY = { RAILWAY_ENVIRONMENT: "production" };

describe("11 — a key on a hosted platform needs a lock this console holds", () => {
  it("refuses a key on Railway with no password", () => {
    expect(codes({ ...RAILWAY, DETHRONE_PRIVATE_KEY: KEY }, null)).toContain(
      "CONSOLE_HOSTED_NO_PASSWORD",
    );
  });

  it("names the platform, so the message is actionable", () => {
    const finding = assertConsoleConfig({ ...RAILWAY, DETHRONE_PRIVATE_KEY: KEY }, null).find(
      (f) => f.code === "CONSOLE_HOSTED_NO_PASSWORD",
    );
    expect(finding?.message).toContain("Railway");
  });

  it("accepts a key on Railway once a password is set", () => {
    expect(
      assertConsoleConfig({ ...RAILWAY, DETHRONE_PRIVATE_KEY: KEY, CONSOLE_PASSWORD: PASSWORD }, null),
    ).toEqual([]);
  });

  it("says nothing about a keyless hosted deploy — there is nothing to protect", () => {
    // Option C, on a different platform. It boots, registers only free commands,
    // and has no wallet for anyone to reach.
    expect(assertConsoleConfig(RAILWAY, null)).toEqual([]);
  });

  it("recognises the other platforms it claims to", () => {
    for (const env of [
      { RENDER: "true" },
      { RENDER_SERVICE_ID: "srv-1" },
      { FLY_APP_NAME: "console" },
      { DYNO: "web.1" },
      { RAILWAY_PROJECT_ID: "p" },
      { RAILWAY_SERVICE_ID: "s" },
    ]) {
      expect(codes({ ...env, DETHRONE_PRIVATE_KEY: KEY }, null)).toContain(
        "CONSOLE_HOSTED_NO_PASSWORD",
      );
    }
  });

  /**
   * Serverless is assertions 4 and 5's case and must not also be this one. Two
   * findings for one deployment is noise, and the Vercel fixtures above assert
   * exactly zero findings on a correct production deploy.
   */
  it("does not fire on Vercel, which assertions 4 and 5 already own", () => {
    expect(
      codes(
        { VERCEL: "1", VERCEL_ENV: "production", DETHRONE_PRIVATE_KEY: KEY, CONSOLE_PROTECTION_CONFIRMED: "true" },
        null,
      ),
    ).toEqual([]);
  });

  /**
   * Two independent refusals, not an exemption. A hosted deploy earns its way
   * out of assertion 3 by having a password; without one it trips both.
   */
  it("does not exempt an unlocked hosted deploy from the loopback check", () => {
    const found = codes({ ...RAILWAY, DETHRONE_PRIVATE_KEY: KEY }, "0.0.0.0");
    expect(found).toContain("CONSOLE_HOSTED_NO_PASSWORD");
    expect(found).toContain("CONSOLE_NOT_LOOPBACK");
  });

  it("exempts a locked hosted deploy from the loopback check", () => {
    // A container binds 0.0.0.0 because that is the only way its proxy reaches
    // it. Refusing over the bind would refuse the documented configuration.
    expect(
      assertConsoleConfig(
        { ...RAILWAY, DETHRONE_PRIVATE_KEY: KEY, CONSOLE_PASSWORD: PASSWORD },
        "0.0.0.0",
      ),
    ).toEqual([]);
  });
});

describe("12 — a password that is set is long enough to be one", () => {
  it("refuses a short password", () => {
    expect(codes({ CONSOLE_PASSWORD: "hunter2" })).toContain("CONSOLE_WEAK_PASSWORD");
  });

  it("refuses a short one on a hosted deploy too, rather than being satisfied by any string", () => {
    expect(codes({ ...RAILWAY, DETHRONE_PRIVATE_KEY: KEY, CONSOLE_PASSWORD: "short" }, null)).toEqual([
      "CONSOLE_WEAK_PASSWORD",
    ]);
  });

  it("says nothing about a long password on a local run", () => {
    // Harmless and useful on a shared machine. A finding here would be the
    // cries-wolf failure this file warns about elsewhere.
    expect(assertConsoleConfig({ CONSOLE_PASSWORD: PASSWORD }, "127.0.0.1")).toEqual([]);
  });
});

describe("13 — a reachable deploy we cannot prove is reachable", () => {
  it("warns, rather than refusing, on CONSOLE_ALLOW_REMOTE with no password", () => {
    // It cannot be a refusal: the same flag is how someone runs this on a
    // private LAN, behind a VPN, or in front of their own authenticating proxy.
    expect(warnings({ DETHRONE_PRIVATE_KEY: KEY, CONSOLE_ALLOW_REMOTE: "true" }, "0.0.0.0")).toEqual([
      "CONSOLE_REMOTE_NO_PASSWORD",
    ]);
    expect(codes({ DETHRONE_PRIVATE_KEY: KEY, CONSOLE_ALLOW_REMOTE: "true" }, "0.0.0.0")).toEqual([]);
  });

  it("says nothing once a password is set", () => {
    expect(
      assertConsoleConfig(
        { DETHRONE_PRIVATE_KEY: KEY, CONSOLE_ALLOW_REMOTE: "true", CONSOLE_PASSWORD: PASSWORD },
        "0.0.0.0",
      ),
    ).toEqual([]);
  });

  it("does not double up with assertion 11 on a known platform", () => {
    expect(
      warnings({ ...RAILWAY, DETHRONE_PRIVATE_KEY: KEY, CONSOLE_ALLOW_REMOTE: "true" }, null),
    ).toEqual([]);
  });
});

describe("full autonomy is refused on a hosted platform, password or not", () => {
  /**
   * The hole this closes. Before `CONSOLE_PASSWORD`, running on Railway forced
   * `CONSOLE_ALLOW_REMOTE`, and that flag is what assertion 9 caught people
   * with. Making the password the way in removed the need for the flag — so
   * without the hosted branch, an agent that signs and pays unattended would
   * have become legal on a public URL holding a key.
   */
  it("refuses even with a password set", () => {
    expect(
      codes(
        {
          ...RAILWAY,
          DETHRONE_PRIVATE_KEY: KEY,
          CONSOLE_PASSWORD: PASSWORD,
          CONSOLE_ALLOW_FULL_AUTONOMY: "true",
        },
        null,
      ),
    ).toEqual(["CONSOLE_AUTONOMY_REMOTE"]);
  });
});

describe("6 — a password named NEXT_PUBLIC_ is a secret in the bundle", () => {
  /**
   * The gap this feature opened and the same commit closed. A password has no
   * *shape* — not 0x-hex, not sk-prefixed — so neither value test can see one,
   * and `scan-bundle.ts` cannot either. The name is the only recognisable thing
   * about a password, so the name is what has to catch it.
   */
  it("refuses a NEXT_PUBLIC_ variable named like a password", () => {
    expect(codes({ NEXT_PUBLIC_CONSOLE_PASSWORD: PASSWORD })).toEqual(["CONSOLE_PUBLIC_SECRET"]);
    expect(codes({ NEXT_PUBLIC_PASSPHRASE: PASSWORD })).toEqual(["CONSOLE_PUBLIC_SECRET"]);
  });

  it("still ignores a short value, so a placeholder does not cry wolf", () => {
    expect(codes({ NEXT_PUBLIC_PASSWORD: "unset" })).toEqual([]);
  });
});

describe("a fresh clone with no configuration at all starts", () => {
  it("produces neither failures nor warnings", () => {
    expect(assertConsoleConfig({}, "127.0.0.1")).toEqual([]);
  });
});
