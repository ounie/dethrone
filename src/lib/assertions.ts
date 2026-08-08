import {
  DEFAULT_AUTONOMY_MAX_CENTS,
  DEFAULT_CONFIRM_OVER_CENTS,
  DEFAULT_MAX_SPEND_CENTS,
} from "./commands";

/**
 * The startup assertions, as a pure function.
 *
 * `assertConsoleConfig(env, host)` returns findings; it never reads
 * `process.env`, never throws, and never touches the filesystem. That is what
 * makes the whole matrix — ten assertions across key/no-key, loopback/remote,
 * and three values of `VERCEL_ENV` — a table-driven unit test with no process
 * to poison and no module cache to reset.
 *
 * The impure half lives in `config.ts`, which calls this once and throws on the
 * first `fail`.
 *
 * ## Why these are assertions and not documentation
 *
 * Every one of them guards the same thing: a key that can spend money sitting
 * in a runtime that more people can reach than the operator intended. A README
 * paragraph stops nobody. A refusal to start stops everybody who forgot, and
 * only inconveniences the one person who meant it — who then sets the flag and
 * has made a choice on the record.
 *
 * ## Assertions 8 to 10, and why only one of them can refuse
 *
 * The agent added three. Two are about the same hazard as the first seven with
 * a machine in the loop — an uncapped autonomous spend (8), and an autonomous
 * agent on a host other people can reach (9) — so 9 refuses outright and 8
 * refuses a cap that is not one.
 *
 * The third only warns, and the line is worth stating: **a misconfigured model
 * provider cannot spend anything.** The worst case is a chat pane that renders
 * disabled with a reason, which is a working console. Refusing to boot over it
 * would make the failure worse than the fault.
 */

export type FindingLevel = "fail" | "warn";

export interface Finding {
  level: FindingLevel;
  code: string;
  message: string;
}

export type EnvLike = Record<string, string | undefined>;

const KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE_RE = /^0x[0-9a-fA-F]{130,}$/;

/**
 * An LLM provider credential, by shape.
 *
 * `sk-` plus twenty-odd URL-safe characters covers every provider this console
 * speaks to: `sk-ant-…` (Anthropic), `sk-or-v1-…` (OpenRouter), `sk-proj-…` and
 * the bare form (OpenAI and the compatible endpoints). It is deliberately
 * anchored — an unanchored version matches inside minified identifiers and
 * hashed asset names, and a boot assertion that cries wolf gets deleted.
 */
const PROVIDER_KEY_RE = /^sk-(?:ant-|or-v1-|proj-)?[A-Za-z0-9_-]{20,}$/;

/**
 * A variable *named* like a credential, whatever its value happens to look
 * like. The shape test above catches the providers we know; this catches the
 * one nobody anticipated, which — per assertion 6's own test — is the case that
 * matters.
 */
const SECRET_NAME_RE = /(?:api[_-]?key|secret[_-]?key|access[_-]?token)$/i;

/**
 * Which env var each chat provider needs, for assertion 10.
 *
 * `claude-max` is absent on purpose: it needs no key at all. It drives a local
 * `claude` subprocess and inherits credentials the operator already has, which
 * is the whole reason it is worth supporting — and also why it cannot run on a
 * platform with no machine to spawn it on.
 */
const PROVIDER_REQUIREMENTS: Record<string, readonly string[]> = {
  openrouter: ["OPENROUTER_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  "openai-compatible": ["OPENAI_COMPATIBLE_BASE_URL", "OPENAI_COMPATIBLE_API_KEY"],
};

/**
 * Loopback, in the forms a Host header or a `--hostname` flag actually takes.
 *
 * The IPv6 cases are the reason this is a function and not a regex. A bare
 * `::1` has no port and its own trailing `:1` looks exactly like one, so
 * stripping `:\d+$` unconditionally turns loopback into `:` and the assertion
 * silently starts refusing a correct configuration. Brackets are the only
 * unambiguous signal that a port follows, which is why they exist.
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const trimmed = host.trim().toLowerCase();
  if (trimmed === "") return false;

  let h: string;
  if (trimmed.startsWith("[")) {
    // `[::1]` or `[::1]:3939` — the address is whatever is inside the brackets.
    h = trimmed.slice(1, trimmed.indexOf("]") === -1 ? undefined : trimmed.indexOf("]"));
  } else if (trimmed.split(":").length > 2) {
    // More than one colon and no brackets: a bare IPv6 address, no port.
    h = trimmed;
  } else {
    h = trimmed.replace(/:\d+$/, "");
  }

  return (
    h === "localhost" ||
    h === "::1" ||
    h === "0:0:0:0:0:0:0:1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
  );
}

export function isTruthyFlag(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "yes";
}

/** Vercel, Lambda, or anything else where two clicks can land in two isolates. */
export function isServerless(env: EnvLike): boolean {
  return env.VERCEL === "1" || !!env.AWS_LAMBDA_FUNCTION_NAME || !!env.FUNCTIONS_WORKER_RUNTIME;
}

/** An https REST URL is Upstash; a redis:// URL is a TCP client we will not open. */
export function resolveKvRest(env: EnvLike): { url: string; token: string } | null {
  const url = env.KV_REST_API_URL ?? (env.KV_URL?.startsWith("https://") ? env.KV_URL : undefined);
  const token = env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

function parseIntOr(value: string | undefined, fallback: number): number | null {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function assertConsoleConfig(env: EnvLike, host: string | null): Finding[] {
  const findings: Finding[] = [];
  const fail = (code: string, message: string) => findings.push({ level: "fail", code, message });
  const warn = (code: string, message: string) => findings.push({ level: "warn", code, message });

  const rawKey = env.DETHRONE_PRIVATE_KEY?.trim();
  const hasKey = !!rawKey;

  // ── 1. The key parses, or we fail here rather than at settle ──────────────
  //
  // A malformed key that reaches the facilitator surfaces as an opaque payment
  // error three layers down, after a request has already left the process.
  if (hasKey && !KEY_RE.test(rawKey)) {
    fail(
      "CONSOLE_BAD_KEY",
      "DETHRONE_PRIVATE_KEY is not a 32-byte hex key. Expected 0x followed by exactly 64 hex characters.",
    );
  }

  // ── 2. The ceiling is above the confirmation threshold ────────────────────
  //
  // Inverted, every paid command would be silently unconfirmable: the ceiling
  // refuses before the confirmation is ever asked for.
  const cap = parseIntOr(env.CONSOLE_MAX_SPEND_CENTS, DEFAULT_MAX_SPEND_CENTS);
  const confirmOver = parseIntOr(env.CONSOLE_CONFIRM_OVER_CENTS, DEFAULT_CONFIRM_OVER_CENTS);
  if (cap === null) {
    fail("CONSOLE_BAD_CAP", "CONSOLE_MAX_SPEND_CENTS must be a non-negative whole number of cents.");
  }
  if (confirmOver === null) {
    fail(
      "CONSOLE_BAD_CONFIRM",
      "CONSOLE_CONFIRM_OVER_CENTS must be a non-negative whole number of cents.",
    );
  }
  if (cap !== null && confirmOver !== null && cap < confirmOver) {
    fail(
      "CONSOLE_CAP_BELOW_CONFIRM",
      `CONSOLE_MAX_SPEND_CENTS (${cap}) is below CONSOLE_CONFIRM_OVER_CENTS (${confirmOver}). The ceiling would refuse everything the confirmation was written to guard.`,
    );
  }

  const vercelEnv = env.VERCEL_ENV;
  const onVercel = isServerless(env);

  // ── 3. A key off loopback needs an explicit acknowledgement ───────────────
  //
  // Three states, not two, and conflating the last two is a bug this code
  // already shipped once:
  //
  //   known loopback     → fine
  //   known non-loopback → refuse
  //   UNKNOWN            → warn, and let the per-request gate do the work
  //
  // The unknown case is the common one and it is not recoverable here. Next's
  // `instrumentation.ts` runs in a CHILD process (`start-server.js`) whose
  // argv is `["node", "start-server.js"]` — the `--hostname` the operator
  // passed to the CLI is simply not visible, and HOST/HOSTNAME are unset
  // unless someone exported them. Treating that silence as "bound to
  // everything" made `pnpm dev` with a key set impossible to start.
  //
  // Refusing on an unknown bind is not the safe default it looks like, because
  // this check was never the thing protecting anyone. `/api/act` re-derives
  // the host from the actual request and refuses paid commands off loopback
  // there — which is strictly more accurate: it reads the Host that a caller
  // really used, so it also catches a tunnel, a reverse proxy, and a
  // `--hostname` overridden after boot. This assertion is an early, friendlier
  // failure for the case it can prove, and nothing more.
  if (hasKey && !onVercel && !isTruthyFlag(env.CONSOLE_ALLOW_REMOTE)) {
    const declared = host !== null && host !== undefined && host.trim() !== "";
    if (declared && isLoopbackHost(host)) {
      // Known loopback. Nothing to say.
    } else if (declared) {
      fail(
        "CONSOLE_NOT_LOOPBACK",
        `A key is set and this server is bound to ${host}, not loopback. A dev server on 0.0.0.0 is a spending endpoint for everyone on the network. Run with --hostname 127.0.0.1 (the bundled "dev" script already does), or set CONSOLE_ALLOW_REMOTE=true if you meant it.`,
      );
    } else {
      warn(
        "CONSOLE_BIND_UNKNOWN",
        'This process cannot see what address it is bound to, so the bind could not be checked at boot. Paid commands are still refused off loopback per request, using the Host header the caller actually sent. To check it here too, export HOST=127.0.0.1 (the bundled "dev" script already does).',
      );
    }
  }

  // ── 4. A key on a preview ─────────────────────────────────────────────────
  //
  // Preview deployments INHERIT environment variables. A Preview-scoped key on
  // an unprotected preview URL is a public wallet wearing a different hat.
  if (hasKey && onVercel && vercelEnv !== "production" && !isTruthyFlag(env.CONSOLE_ALLOW_PREVIEW_KEY)) {
    fail(
      "CONSOLE_PREVIEW_KEY",
      `A key is present on a Vercel ${vercelEnv ?? "non-production"} deployment. Previews inherit environment variables and have their own URLs. Scope the key to Production only, or set CONSOLE_ALLOW_PREVIEW_KEY=true.`,
    );
  }

  // ── 5. A key on production without protection ─────────────────────────────
  //
  // The runtime cannot read Vercel's Deployment Protection setting, so the
  // explicit acknowledgement is the substitute. Someone who lies to it has made
  // a choice; someone who forgot has been stopped.
  if (hasKey && onVercel && vercelEnv === "production" && !isTruthyFlag(env.CONSOLE_PROTECTION_CONFIRMED)) {
    fail(
      "CONSOLE_NO_PROTECTION",
      "A key is present on a Vercel production deployment and CONSOLE_PROTECTION_CONFIRMED is not set. A URL anyone can reach that can spend a wallet is a hosted wallet with no auth. Turn on Deployment Protection, then set CONSOLE_PROTECTION_CONFIRMED=true to acknowledge it.",
    );
  }

  // ── 6. No NEXT_PUBLIC_ variable holds a secret ────────────────────────────
  //
  // Over the whole env, not a fixed list — the prefix inlines its value into the
  // client bundle at BUILD time, which is why this assertion has to run in the
  // build and not only at boot.
  //
  // The agent widened what "a secret" means here. Until it arrived, the only
  // credential this console could hold was 32 bytes of hex, so a 0x-shaped test
  // was a complete test. An LLM provider key is `sk-` and base62, matches
  // neither regex, and would have sailed into the bundle unremarked. So there
  // are now three ways to fail: the value looks like a wallet key, the value
  // looks like a provider key, or the NAME says it is a credential regardless of
  // what the value looks like. The third exists because the next provider will
  // have a key shape nobody here has seen.
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("NEXT_PUBLIC_") || !value) continue;
    const v = value.trim();
    const bare = name.slice("NEXT_PUBLIC_".length);

    if (KEY_RE.test(v) || SIGNATURE_RE.test(v)) {
      fail(
        "CONSOLE_PUBLIC_SECRET",
        `${name} holds a value shaped like a private key or a signature. Anything prefixed NEXT_PUBLIC_ is inlined into the browser bundle. Rename it.`,
      );
    } else if (PROVIDER_KEY_RE.test(v)) {
      fail(
        "CONSOLE_PUBLIC_SECRET",
        `${name} holds a value shaped like an LLM provider API key. Anything prefixed NEXT_PUBLIC_ is inlined into the browser bundle, where a provider key is a bill anyone can run up. Drop the prefix.`,
      );
    } else if (SECRET_NAME_RE.test(bare) && v.length >= 16) {
      fail(
        "CONSOLE_PUBLIC_SECRET",
        `${name} is named like a credential and prefixed NEXT_PUBLIC_, which inlines it into the browser bundle. If it really is public, rename it so nobody has to wonder.`,
      );
    }
  }

  // ── 7. Serverless without a shared store ──────────────────────────────────
  //
  // A warning and not a failure, because the read-only deploy is a genuinely
  // useful artifact and has nothing to protect. What must not happen is the
  // ceiling silently becoming per-invocation while still rendering a number.
  if (onVercel && !resolveKvRest(env)) {
    if (env.KV_URL && !env.KV_URL.startsWith("https://")) {
      warn(
        "CONSOLE_KV_WRONG_SHAPE",
        "KV_URL is set but is not an https REST URL. On serverless a redis:// TCP client opens a connection per invocation and will exhaust the pool. Use KV_REST_API_URL and KV_REST_API_TOKEN.",
      );
    }
    if (hasKey) {
      warn(
        "CONSOLE_CEILING_DISABLED",
        "Serverless with no KV store: invocations do not share memory, so the spend ceiling cannot bound a sitting. It is DISABLED rather than reset silently, and the screen says so. Set KV_REST_API_URL and KV_REST_API_TOKEN to restore it.",
      );
    }
  }

  // ── 8. The per-action autonomy cap parses, and is a cap ───────────────────
  //
  // An autonomous agent's cap is not the same object as the sitting ceiling.
  // The ceiling bounds everything you do in one session; this bounds one action
  // a machine takes without asking. Set equal to or above the ceiling it stops
  // being a per-action cap at all — one bad turn spends the entire sitting and
  // the second guard was never a guard.
  const autonomyCap = parseIntOr(env.CONSOLE_AUTONOMY_MAX_CENTS, DEFAULT_AUTONOMY_MAX_CENTS);
  if (autonomyCap === null) {
    fail(
      "CONSOLE_BAD_AUTONOMY_CAP",
      "CONSOLE_AUTONOMY_MAX_CENTS must be a non-negative whole number of cents.",
    );
  }
  if (autonomyCap !== null && cap !== null && autonomyCap > cap) {
    fail(
      "CONSOLE_AUTONOMY_ABOVE_CAP",
      `CONSOLE_AUTONOMY_MAX_CENTS (${autonomyCap}) is above CONSOLE_MAX_SPEND_CENTS (${cap}). A per-action cap above the sitting ceiling is not a cap — one autonomous action could spend everything.`,
    );
  }

  // ── 9. Full autonomy is loopback-only, and that is enforced at boot ───────
  //
  // The runtime gate in `autonomy.ts` already refuses to offer a grant where the
  // ceiling cannot bound a sitting. This is the earlier, blunter half: a
  // reachable URL that can both spend a wallet AND decide for itself when to is
  // the deployment shape the README bars outright, with a language model where
  // the timer would be. Refusing here means nobody discovers it from a receipt.
  //
  // `CONSOLE_ALLOW_REMOTE` is included deliberately. It is the flag that turns
  // off the per-request loopback check, so it is exactly the flag that would
  // otherwise make this one vacuous.
  if (hasKey && isTruthyFlag(env.CONSOLE_ALLOW_FULL_AUTONOMY)) {
    if (onVercel) {
      fail(
        "CONSOLE_AUTONOMY_REMOTE",
        "CONSOLE_ALLOW_FULL_AUTONOMY is set on a serverless deployment that holds a key. An agent that can sign and pay without being asked, behind a URL other people can reach, is the deployment shape this console refuses to build. Run it locally.",
      );
    } else if (isTruthyFlag(env.CONSOLE_ALLOW_REMOTE)) {
      fail(
        "CONSOLE_AUTONOMY_REMOTE",
        "CONSOLE_ALLOW_FULL_AUTONOMY and CONSOLE_ALLOW_REMOTE are both set. CONSOLE_ALLOW_REMOTE turns off the per-request loopback check that is the only thing keeping an autonomous agent on your own machine. Pick one.",
      );
    }
  }

  // ── 10. A named chat provider can actually run here ───────────────────────
  //
  // A warning, not a failure: naming a provider you have not configured yet is
  // a half-finished setup, not a hazard. Nothing here can spend. The console
  // renders the reason beside the provider and falls back to whatever else is
  // available, so the only thing this adds is saying so at boot instead of
  // making the operator find it in the UI.
  const named = env.CONSOLE_CHAT_PROVIDER?.trim();
  if (named) {
    if (named === "claude-max") {
      if (onVercel) {
        warn(
          "CONSOLE_CHAT_SUBPROCESS_UNAVAILABLE",
          "CONSOLE_CHAT_PROVIDER=claude-max drives a local `claude` subprocess and inherits your own Claude Code credentials. A serverless invocation has neither a machine to spawn it on nor credentials to inherit, so this provider will render unavailable.",
        );
      }
    } else if (!(named in PROVIDER_REQUIREMENTS)) {
      warn(
        "CONSOLE_CHAT_PROVIDER_UNKNOWN",
        `CONSOLE_CHAT_PROVIDER=${named} is not a provider this console knows. Expected one of: ${["claude-max", ...Object.keys(PROVIDER_REQUIREMENTS)].join(", ")}.`,
      );
    } else {
      const missing = PROVIDER_REQUIREMENTS[named].filter((v) => !env[v]?.trim());
      if (missing.length > 0) {
        warn(
          "CONSOLE_CHAT_PROVIDER_UNAVAILABLE",
          `CONSOLE_CHAT_PROVIDER=${named} but ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set, so that provider will render unavailable.`,
        );
      }
    }
  }

  return findings;
}
