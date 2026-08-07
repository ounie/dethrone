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
 * The host this server is bound to, for assertion 3 — or `null` when it cannot
 * be determined, which is the common case and must not be mistaken for
 * "bound to everything".
 *
 * There is no portable API for "what did I bind to". `argv` is checked first
 * and works for a directly-invoked server, but **Next's `instrumentation.ts`
 * runs in a child process** (`start-server.js`) whose argv is
 * `["node", "start-server.js"]` — the `--hostname` the operator passed to the
 * CLI is not visible there at all. So the env vars are the load-bearing path,
 * and `package.json`'s `dev` script sets `HOST=127.0.0.1` alongside
 * `--hostname 127.0.0.1` for exactly that reason: one does the binding, the
 * other makes it checkable from the process that does the checking.
 *
 * When this returns null the assertion warns rather than refuses. The
 * enforcement lives in `paidCommandsAllowedFrom` below, which reads the Host of
 * a real request and is strictly more accurate.
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
 * Assertion 3's request half — and the half that actually protects anyone.
 *
 * The boot check can only speak about a bind address it can see, which is often
 * none (see `bootHost`). The host that matters is the one a caller really used,
 * so every paid command re-derives it from the request. This catches the
 * tunnel, the reverse proxy, and the `--hostname` overridden after boot — none
 * of which a boot-time check could ever have seen.
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
