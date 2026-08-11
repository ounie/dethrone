import {
  DEFAULT_AUTONOMY_MAX_CENTS,
  DEFAULT_CONFIRM_OVER_CENTS,
  DEFAULT_MAX_SPEND_CENTS,
} from "./commands";
// One constant, and the import direction is deliberate: `session.ts` imports
// nothing at all (it has to run on the Edge runtime, where most of this repo
// does not), so the shared number lives there and is read here rather than the
// other way round. It is a plain integer — nothing in this file's purity claim
// is weakened by it.
import { MIN_PASSWORD_LENGTH } from "./session";

/**
 * The startup assertions, as a pure function.
 *
 * `assertConsoleConfig(env, host)` returns findings; it never reads
 * `process.env`, never throws, and never touches the filesystem. That is what
 * makes the whole matrix — thirteen assertions across key/no-key,
 * loopback/remote, password/no-password, and three values of `VERCEL_ENV` — a
 * table-driven unit test with no process to poison and no module cache to
 * reset.
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
 *
 * ## Assertions 11 to 13, and why 13 is the honest one
 *
 * These three arrived with `CONSOLE_PASSWORD`, and they exist because assertions
 * 4 and 5 quietly assumed the only place this could be hosted was Vercel. On a
 * long-lived container platform — Railway, Render, Fly — there is no Deployment
 * Protection to acknowledge, so 5's model of "the platform authenticates and you
 * confirm it did" has nothing to point at. 11 replaces the acknowledgement with
 * a lock this process can actually check, and refuses without one.
 *
 * 12 is the same argument one level down: an unenforced minimum makes 11 a
 * formality.
 *
 * 13 is the case neither can prove. A bare VPS injects no telltale variable, so
 * `isHosted` cannot see it; all this file has is `CONSOLE_ALLOW_REMOTE`, which
 * an operator also sets for a private LAN, a VPN, and their own authenticating
 * proxy. **So it warns.** The rule this follows is the one assertion 3 already
 * learned the hard way: refuse what you can prove, warn about what you cannot,
 * and never refuse a correct configuration to catch an incorrect one that looks
 * the same from here.
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
 *
 * `password` and `passphrase` were added with `CONSOLE_PASSWORD`, and the gap
 * they close is worth recording because the feature opened it and the same
 * commit shut it. An operator's password has no *shape* — it is not `0x`-hex
 * and not `sk-`-prefixed — so neither of the two value tests above can see one,
 * and `scripts/scan-bundle.ts` cannot either, for the same reason. A
 * `NEXT_PUBLIC_CONSOLE_PASSWORD` would therefore have been inlined into the
 * browser bundle and passed every check this repo has. The name is the only
 * thing about a password that is ever recognisable, so the name is what this
 * has to catch.
 */
const SECRET_NAME_RE = /(?:api[_-]?key|secret[_-]?key|access[_-]?token|password|passphrase)$/i;

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

/** Exported so the boot check and `wallet.ts` test the same shape. */
export function isWalletKey(value: string): boolean {
  return KEY_RE.test(value);
}

/** One configured wallet key, identified by its variable NAME. Never its value. */
export interface WalletKeyVar {
  /** The environment variable, e.g. `DETHRONE_PRIVATE_KEY_SCRAPYARD`. */
  name: string;
  /** Stable id, from the suffix. Compared, never rendered. */
  id: string;
  /** What the picker says. Derived from the NAME, never from the key. */
  label: string;
  primary: boolean;
}

const KEY_VAR = "DETHRONE_PRIVATE_KEY";
const SUFFIX_RE = /^[A-Za-z0-9][A-Za-z0-9_]*$/;

/** `COLD_STORAGE` → `Cold Storage`, `SCRAPYARD` → `Scrapyard`, `2` → `2`. */
function labelFor(suffix: string): string {
  return suffix
    .split("_")
    .map((part) => (/^\d+$/.test(part) ? part : part[0].toUpperCase() + part.slice(1).toLowerCase()))
    .join(" ");
}

/**
 * Which environment variables hold a wallet key, in the order the console
 * offers them.
 *
 * ## It returns names, never values
 *
 * That is the property that makes it safe to live here. `assertions.ts` is
 * deliberately **not** `server-only` — `scripts/assert-config.ts` imports it
 * from a bare `tsx` process — so a function here that returned raw keys would
 * be a new place a secret can escape. Every caller reads `env[name]` itself,
 * which preserves the rule `wallet.ts` states at length: reading a raw key is a
 * visible act at the call site, not something a helper does on your behalf.
 *
 * ## Why the scan lives here and not in `wallet.ts`
 *
 * The boot check and the runtime must agree on which variables are wallet keys.
 * Two scans would drift on the ordering rule or the label derivation, and the
 * drift would be invisible: the boot check would validate a variable the
 * runtime never loads, or — worse — the runtime would happily sign with a key
 * nothing ever validated. One definition, three consumers: this file's
 * assertion 1, `wallet.ts`, and the redaction lists in the two routes that need
 * to know every secret this process holds.
 *
 * ## Empty after trim is absent
 *
 * Not a detail. `config().hasKey` and `wallet.ts`'s `hasWallet()` are computed
 * by different code paths and must agree; a variable set to `""` (which is how
 * several tests stub an absent one, and how `${VAR}` expansion renders an unset
 * one) has to read as "no key" on both sides. Divergence here means a deploy
 * that refuses to boot over a key it cannot use, or one that offers a wallet
 * that cannot sign.
 */
export function walletKeyVars(env: EnvLike): WalletKeyVar[] {
  const found: WalletKeyVar[] = [];
  let primary: WalletKeyVar | null = null;

  for (const name of Object.keys(env)) {
    if (!name.startsWith(KEY_VAR)) continue;
    if (!env[name]?.trim()) continue;

    if (name === KEY_VAR) {
      primary = { name, id: "primary", label: "Primary", primary: true };
      continue;
    }
    if (name[KEY_VAR.length] !== "_") continue;

    const suffix = name.slice(KEY_VAR.length + 1);
    // A variable this console does not recognise is not this console's
    // business. Warning about it would fire on someone's unrelated
    // `DETHRONE_PRIVATE_KEY-BACKUP` note, and a warning that cries wolf is a
    // warning that gets switched off.
    if (!SUFFIX_RE.test(suffix)) continue;

    found.push({ name, id: suffix.toLowerCase(), label: labelFor(suffix), primary: false });
  }

  // Plain `<`, not `localeCompare`: the latter is locale- and ICU-dependent, so
  // an ordering that claims to be deterministic would in fact depend on the
  // host's locale data. ASCII puts `_2` before `_SCRAPYARD`, and that is the
  // order the tests pin.
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return primary ? [primary, ...found] : found;
}

/** Vercel, Lambda, or anything else where two clicks can land in two isolates. */
export function isServerless(env: EnvLike): boolean {
  return env.VERCEL === "1" || !!env.AWS_LAMBDA_FUNCTION_NAME || !!env.FUNCTIONS_WORKER_RUNTIME;
}

/**
 * A long-lived container on a platform that gives it a public URL — Railway and
 * its neighbours.
 *
 * ## Why this is a third category and not "serverless"
 *
 * The two differ on the one property the rest of this file reasons about. On
 * serverless, invocations do not share memory, so the spend ceiling needs a KV
 * store (assertion 7) — but the platform supplies the authentication, which
 * assertion 5 makes the operator acknowledge. Here it is the other way round:
 * the process is long-lived so the in-memory ceiling is a real bound, and there
 * is **no platform authentication at all**. A public URL in front of a wallet,
 * with nothing asking who is knocking.
 *
 * That is why assertion 11 exists and why it *refuses* rather than asking for an
 * acknowledgement the way assertion 5 does. There is no Deployment Protection
 * to point at, so the honest options are "the console holds the lock itself" or
 * "do not run it here". `CONSOLE_PASSWORD` is the first one.
 *
 * ## Detection is by the platform's own variables
 *
 * Not by a flag the operator sets, because the failure this guards is *someone
 * deployed and did not think about it* — and a flag you have to remember is no
 * use against forgetting. Each platform below injects these into every service
 * it runs, without being asked.
 *
 * The list is allowed to be incomplete, and it is worth being clear about what
 * that costs: an unlisted platform falls through to the `CONSOLE_ALLOW_REMOTE`
 * warning further down rather than to a refusal. That is the correct shape of
 * the gap — this function can prove a host is public, it can never prove one is
 * private, and a refusal on an unprovable claim is the mistake assertion 3
 * already documents at length.
 */
export function hostedPlatform(env: EnvLike): string | null {
  // Serverless is assertions 4 and 5's case, and it must not also be this one.
  // Two findings for one deployment would be noise, and — the mechanical reason
  // — the Vercel fixtures in `test/assertions.test.ts` assert *exactly zero*
  // findings on a correctly configured production deploy. Overlapping here
  // would break four of them at once.
  if (isServerless(env)) return null;

  // Railway sets all three on every service; RAILWAY_ENVIRONMENT is present
  // even before a public domain is attached.
  if (env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID) return "Railway";
  if (env.RENDER || env.RENDER_SERVICE_ID) return "Render";
  if (env.FLY_APP_NAME) return "Fly.io";
  // Heroku, and only when the operator has enabled dyno metadata.
  if (env.DYNO) return "Heroku";
  return null;
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

  const keyVars = walletKeyVars(env);
  const hasKey = keyVars.length > 0;

  // ── 1. Every configured key parses, or we fail here rather than at settle ──
  //
  // A malformed key that reaches the facilitator surfaces as an opaque payment
  // error three layers down, after a request has already left the process.
  //
  // The message names WHICH variable. With one key that was obvious; with a
  // dropdown's worth it is the difference between a one-line fix and reading
  // sixty-four hex characters off four lines of `.env.local`. The CODE stays
  // `CONSOLE_BAD_KEY` — it is the same fault, and every caller matching on it
  // is still right.
  const seen = new Map<string, string>();
  for (const v of keyVars) {
    const raw = env[v.name]!.trim();
    if (!isWalletKey(raw)) {
      fail(
        "CONSOLE_BAD_KEY",
        `${v.name} is not a 32-byte hex key. Expected 0x followed by exactly 64 hex characters.`,
      );
      continue;
    }
    // Two names for one wallet. A warning and not a refusal: now that the
    // ceiling is sitting-wide rather than per-address, the consequence is a
    // confusing dropdown, not a hazard — and refusing to boot over a
    // copy-paste is a failure worse than the fault.
    const first = seen.get(raw);
    if (first) {
      warn(
        "CONSOLE_DUPLICATE_WALLET_KEY",
        `${v.name} holds the same key as ${first}. They are one wallet under two names, and the picker will show it twice.`,
      );
    } else {
      seen.set(raw, v.name);
    }
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
  const hosted = hostedPlatform(env);
  const password = env.CONSOLE_PASSWORD?.trim();

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
  //
  // A hosted container is excluded alongside `onVercel`, but only **once it has
  // a password**, and that conjunction is the whole point. Such a container
  // binds `0.0.0.0` because that is the only way its proxy can reach it, so
  // loopback is not a property that can hold there and refusing over it would
  // refuse the documented, correct configuration. What stands in for the bind is
  // the lock assertion 11 demands — so a hosted deploy *without* one trips this
  // assertion and assertion 11 both, and shape D gets two independent refusals
  // rather than an exemption it did not earn.
  const hostedAndLocked = hosted !== null && !!password;
  if (hasKey && !onVercel && !hostedAndLocked && !isTruthyFlag(env.CONSOLE_ALLOW_REMOTE)) {
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
  //
  // The `hosted` branch closes a hole this feature would otherwise have opened.
  // Before `CONSOLE_PASSWORD`, running on Railway forced the operator to set
  // `CONSOLE_ALLOW_REMOTE`, and that flag is what this assertion was catching
  // them with. Making the password the way in removes the need for the flag —
  // so without this branch, `CONSOLE_ALLOW_FULL_AUTONOMY` would have quietly
  // become legal on a public URL holding a key. The password does not license
  // that: it proves a browser belongs to the operator, and it does not supervise
  // a machine that decides for itself when to spend.
  if (hasKey && isTruthyFlag(env.CONSOLE_ALLOW_FULL_AUTONOMY)) {
    if (onVercel || hosted !== null) {
      fail(
        "CONSOLE_AUTONOMY_REMOTE",
        // A password does NOT soften this, and the temptation to wire it in is
        // the reason this sentence is here. A login proves a browser belongs to
        // the operator; it does not supervise a machine that decides for itself
        // when to spend. The two guards answer different questions and neither
        // substitutes for the other.
        "CONSOLE_ALLOW_FULL_AUTONOMY is set on a hosted deployment that holds a key. An agent that can sign and pay without being asked, behind a URL other people can reach, is the deployment shape this console refuses to build — a password on the front door does not change that, because the agent is already inside it. Run it locally.",
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
          "CONSOLE_CHAT_PROVIDER=claude-max, but a Claude Max or Pro subscription works on LOCAL RUNS ONLY: it drives a `claude` subprocess and inherits credentials from your own machine, and this deploy has neither. Use an LLM provider API key here instead — OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or an OpenAI-compatible base URL and key.",
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

  // ── 11. A key on a hosted platform needs a lock this console actually holds ─
  //
  // The counterpart to assertion 5, and deliberately stricter than it.
  //
  // Assertion 5 can only ask for an *acknowledgement*, because Vercel's
  // Deployment Protection is real authentication that this runtime has no way to
  // read. There is no equivalent on Railway or Render: the URL is public the
  // moment the service is up, and nothing stands in front of it. So the
  // substitute is not a flag saying "I turned something on elsewhere" — it is a
  // password this process can check on every request, which is the only claim it
  // can verify for itself.
  //
  // Refusing rather than warning, on the same argument the file opens with: the
  // shape being prevented is a hosted wallet with no auth, which the README bars
  // outright as option D. Someone who genuinely wants an unlocked public wallet
  // can still have one — by not setting a key, which is option C and boots fine.
  if (hasKey && hosted !== null && !password) {
    fail(
      "CONSOLE_HOSTED_NO_PASSWORD",
      `A key is present on ${hosted} and CONSOLE_PASSWORD is not set. This platform gives a service a public URL with no authentication in front of it, so this is a wallet anyone who finds the URL can spend. Set CONSOLE_PASSWORD to put a login on it, or remove the key and run a read-only deploy.`,
    );
  }

  // ── 12. A password that is set is long enough to be one ───────────────────
  //
  // The throttle on `/api/session` is per-process and best-effort — it slows a
  // guesser rather than stopping one — so length is the part doing the work. A
  // refusal and not a warning because the failure is silent: a four-character
  // password looks exactly as protected as a good one from the outside, right up
  // until it isn't.
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    fail(
      "CONSOLE_WEAK_PASSWORD",
      `CONSOLE_PASSWORD is ${password.length} characters. This is the only thing between a public URL and a wallet that can spend, and the login throttle is per-process and best-effort, so the length is what actually resists guessing. Use at least ${MIN_PASSWORD_LENGTH}.`,
    );
  }

  // ── 13. A reachable deploy with a key and no lock, where we cannot prove it ─
  //
  // The honest half of assertion 11. `isHosted` recognises the platforms it
  // knows; it cannot recognise a bare VPS, a Docker host, or a tunnel, and
  // `CONSOLE_ALLOW_REMOTE` is the operator saying "this is reachable" in as many
  // words.
  //
  // A **warning** and not a refusal, and the line is worth drawing precisely.
  // On a known platform the URL is public by construction and a refusal is
  // provably right. Here it is not: `CONSOLE_ALLOW_REMOTE` is also how someone
  // runs this on a private LAN, behind a VPN, or in front of their own
  // authenticating proxy — all of which are fine, and none of which this process
  // can distinguish from the open internet. Refusing them all to catch the one
  // would be the mistake assertion 3 documents at length, and the flag would get
  // set anyway.
  if (hasKey && hosted === null && !onVercel && isTruthyFlag(env.CONSOLE_ALLOW_REMOTE) && !password) {
    warn(
      "CONSOLE_REMOTE_NO_PASSWORD",
      "CONSOLE_ALLOW_REMOTE is set with a key and no CONSOLE_PASSWORD, so the per-request loopback check is off and nothing else asks who is calling. That is correct if something in front of this — a VPN, a private network, an authenticating proxy — is doing the asking. If nothing is, set CONSOLE_PASSWORD.",
    );
  }

  return findings;
}
