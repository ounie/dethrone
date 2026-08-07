import { DEFAULT_CONFIRM_OVER_CENTS, DEFAULT_MAX_SPEND_CENTS } from "./commands";

/**
 * The startup assertions, as a pure function.
 *
 * `assertConsoleConfig(env, host)` returns findings; it never reads
 * `process.env`, never throws, and never touches the filesystem. That is what
 * makes the whole matrix — seven assertions across key/no-key, loopback/remote,
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
  // Only checkable where there IS a bind address — which is local. On Vercel the
  // process has no bind address to inspect, so the request half of this rule
  // lives in /api/act, which re-derives the host per request. Splitting it is
  // the honest thing; pretending one check covers both is not.
  if (hasKey && !onVercel && !isLoopbackHost(host) && !isTruthyFlag(env.CONSOLE_ALLOW_REMOTE)) {
    fail(
      "CONSOLE_NOT_LOOPBACK",
      `A key is set and this server is bound to ${host ?? "all interfaces"}, not loopback. A dev server on 0.0.0.0 is a spending endpoint for everyone on the network. Run with --hostname 127.0.0.1 (the bundled "dev" script already does), or set CONSOLE_ALLOW_REMOTE=true if you meant it.`,
    );
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
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("NEXT_PUBLIC_") || !value) continue;
    const v = value.trim();
    if (KEY_RE.test(v) || SIGNATURE_RE.test(v)) {
      fail(
        "CONSOLE_PUBLIC_SECRET",
        `${name} holds a value shaped like a private key or a signature. Anything prefixed NEXT_PUBLIC_ is inlined into the browser bundle. Rename it.`,
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

  return findings;
}
