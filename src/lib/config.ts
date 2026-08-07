import "server-only";
import {
  assertConsoleConfig,
  isLoopbackHost,
  isServerless,
  isTruthyFlag,
  resolveKvRest,
  type Finding,
} from "./assertions";
import { DEFAULT_CONFIRM_OVER_CENTS, DEFAULT_MAX_SPEND_CENTS } from "./commands";

/**
 * The impure half of the boot assertions: read the environment once, run the
 * pure checks, throw on the first failure, and memoize the result.
 *
 * Called from three places, and one is not enough:
 *
 *  - `src/instrumentation.ts` — Next's `register()` hook, before any request is
 *    served. This is the "startup" in "startup assertion", and it is what makes
 *    `pnpm dev` refuse to come up.
 *  - `scripts/assert-config.ts`, gating `pnpm build`. Serverless has no startup
 *    you can fail a *deploy* on, and the NEXT_PUBLIC_ scan is only meaningful
 *    at build time because that prefix is inlined into the bundle then.
 *  - The top of `/api/act` and the page. Belt and braces: no request is served
 *    by a process whose assertions have not passed.
 */

export interface ConsoleConfig {
  baseUrl: string;
  network: string;
  hasKey: boolean;
  maxSpendCents: number;
  confirmOverCents: number;
  allowRemote: boolean;
  allowGenesis: boolean;
  devBypass: boolean;
  serverless: boolean;
  kv: { url: string; token: string } | null;
  /** False when the ceiling cannot bound a sitting. The UI says so; it never shows a number. */
  ceilingEnabled: boolean;
  ceilingDisabledReason?: string;
  findings: Finding[];
}

let cached: ConsoleConfig | null = null;

/**
 * The host this server is bound to, for assertion 3.
 *
 * There is no portable API for "what did I bind to", so this reads the flag the
 * operator actually passed, then the conventional env vars. Next's dev server
 * binds `0.0.0.0` by default, so **absent an explicit flag this resolves to
 * null and the assertion fails** — which is correct, and is exactly why
 * `package.json`'s `dev` script hard-codes `--hostname 127.0.0.1`. A reader who
 * types `pnpm dev` gets the safe thing; a reader who types `next dev` with a
 * key gets refused and told why.
 */
function bootHost(): string | null {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--hostname" || argv[i] === "-H") return argv[i + 1] ?? null;
    const inline = /^--hostname=(.+)$/.exec(argv[i]);
    if (inline) return inline[1];
  }
  return process.env.HOST ?? process.env.HOSTNAME ?? null;
}

function intOr(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function config(): ConsoleConfig {
  if (cached) return cached;

  const env = process.env;
  const findings = assertConsoleConfig(env, bootHost());

  const fatal = findings.filter((f) => f.level === "fail");
  if (fatal.length > 0) {
    throw new Error(
      ["Dethrone Console refuses to start:", ...fatal.map((f) => `  ${f.code}  ${f.message}`)].join(
        "\n",
      ),
    );
  }

  for (const w of findings) {
    if (w.level === "warn") console.warn(`[console] ${w.code}: ${w.message}`);
  }

  const serverless = isServerless(env);
  const kv = resolveKvRest(env);
  const hasKey = !!env.DETHRONE_PRIVATE_KEY?.trim();

  // The ceiling is a real bound only where a single process (or a shared store)
  // observes every spend. Anywhere else it renders as "disabled" rather than as
  // a number that would be lying — a disabled seatbelt that announces itself is
  // safer than one that silently resets.
  const ceilingEnabled = !serverless || !!kv;

  cached = {
    baseUrl: (env.DETHRONE_BASE_URL ?? "https://dethrone.bot").replace(/\/+$/, ""),
    network: env.DETHRONE_NETWORK ?? "base",
    hasKey,
    maxSpendCents: intOr(env.CONSOLE_MAX_SPEND_CENTS, DEFAULT_MAX_SPEND_CENTS),
    confirmOverCents: intOr(env.CONSOLE_CONFIRM_OVER_CENTS, DEFAULT_CONFIRM_OVER_CENTS),
    allowRemote: isTruthyFlag(env.CONSOLE_ALLOW_REMOTE),
    allowGenesis: isTruthyFlag(env.CONSOLE_ALLOW_GENESIS),
    devBypass: isTruthyFlag(env.CONSOLE_DEV_BYPASS),
    serverless,
    kv,
    ceilingEnabled,
    ceilingDisabledReason: ceilingEnabled
      ? undefined
      : "Serverless invocations do not share memory, so a per-process counter cannot bound a sitting. Set KV_REST_API_URL and KV_REST_API_TOKEN to restore it.",
    findings,
  };

  return cached;
}

/**
 * Assertion 3's request half.
 *
 * The boot check can only see a bind address where there is one, which is
 * local. On a platform the operator does not administer, the host that matters
 * is the one on the request — so every paid command re-derives it. This catches
 * the tunnel, the reverse proxy, and the `--hostname` that was overridden after
 * boot.
 */
export function paidCommandsAllowedFrom(requestHost: string | null): boolean {
  const cfg = config();
  if (cfg.allowRemote) return true;
  // On a managed platform the operator has already acknowledged the exposure
  // through assertions 4 and 5; loopback is meaningless there.
  if (cfg.serverless) return true;
  return isLoopbackHost(requestHost);
}

/** Test seam. Never called in production. */
export function __resetConfigCache(): void {
  cached = null;
}
