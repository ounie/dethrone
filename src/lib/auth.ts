import "server-only";
import { hostedPlatform } from "./assertions";
import {
  SESSION_COOKIE,
  type SessionState,
  cookieValue,
  clearCookie,
  mint,
  passwordMatches,
  sessionKey,
  setCookie,
  verify,
} from "./session";

/**
 * The impure half of the door: read `CONSOLE_PASSWORD`, derive the key once,
 * hold the throttle. `session.ts` is the pure half and carries the argument for
 * the split.
 *
 * Nothing here returns the password. Every export answers with a boolean, a
 * `SessionState`, or a `Set-Cookie` string — the same rule `wallet.ts` states
 * about the private key, for the same reason: an accessor would be used within a
 * month and every caller of it would be a new place a secret can escape.
 */

/**
 * The configured password, or null when the gate is off.
 *
 * Empty-after-trim reads as absent, matching `walletKeyVars` in `assertions.ts`.
 * A variable set to `""` is how an unset `${VAR}` expansion renders, and "the
 * gate is on and the password is the empty string" must never be reachable.
 */
function configured(): string | null {
  const raw = process.env.CONSOLE_PASSWORD;
  if (typeof raw !== "string") return null;
  return raw.trim() === "" ? null : raw;
}

/**
 * Whether this deploy has a password at all.
 *
 * When false the gate is **off** and every request is allowed. That is the
 * correct behaviour for the default local run on loopback, where the bind has
 * always been the protection — a fresh clone must not grow a login screen. It is
 * also what keeps every existing route test meaningful without threading a
 * cookie through it. Assertion 11 is what stops that default from silently
 * following a key onto a public host.
 */
export function passwordRequired(): boolean {
  return configured() !== null;
}

/**
 * The derived key, memoized against the password it came from.
 *
 * PBKDF2 at 210k iterations costs roughly 100ms, so it is paid once per process
 * rather than once per request — memoizing the *key* and not the verification,
 * which is the distinction that matters: every token is still checked.
 *
 * Keyed on the password so a change to the variable re-derives rather than
 * serving a stale key. It lives on `globalThis` for the reason `spend.ts` and
 * `autonomy.ts` do: Next re-evaluates modules on hot reload, and a module-level
 * cache would silently re-pay the cost on every edit during development.
 */
interface AuthState {
  key: { password: string; derived: Promise<CryptoKey> } | null;
  failures: number;
  lockedUntil: number;
}

const STATE = Symbol.for("dethrone.console.auth");

function state(): AuthState {
  const holder = globalThis as unknown as Record<symbol, AuthState | undefined>;
  return (holder[STATE] ??= { key: null, failures: 0, lockedUntil: 0 });
}

function keyFor(password: string): Promise<CryptoKey> {
  const s = state();
  if (s.key?.password !== password) {
    s.key = { password, derived: sessionKey(password) };
  }
  return s.key.derived;
}

/** Whether a token is a live session. `"not-required"` when no password is set. */
export async function sessionFrom(token: string | undefined): Promise<SessionState> {
  const password = configured();
  if (password === null) return "not-required";
  const result = await verify(await keyFor(password), token, Date.now());
  return result === "valid" ? "valid" : "invalid";
}

/** The same, for a handler that holds the `Request`. */
export async function authenticate(req: Request): Promise<SessionState> {
  if (!passwordRequired()) return "not-required";
  return sessionFrom(cookieValue(req.headers.get("cookie"), SESSION_COOKIE));
}

/** Whether an offered password is the configured one. False when none is set. */
export async function checkPassword(offered: string): Promise<boolean> {
  const password = configured();
  if (password === null) return false;
  return passwordMatches(await keyFor(password), offered, password);
}

/** A `Set-Cookie` value carrying a fresh session, or null when the gate is off. */
export async function issue(secure: boolean): Promise<string | null> {
  const password = configured();
  if (password === null) return null;
  return setCookie(await mint(await keyFor(password), Date.now()), { secure });
}

/** A `Set-Cookie` value that clears the session. */
export function revoke(secure: boolean): string {
  return clearCookie({ secure });
}

/**
 * Whether the cookie may be marked `Secure`.
 *
 * Read from the **platform**, not from `x-forwarded-proto`. That header is set
 * by a trusted proxy on a hosted deploy and by whoever is calling everywhere
 * else — so trusting it means a caller can ask for a cookie without `Secure` and
 * get one. Every platform `hostedPlatform` recognises terminates TLS, which
 * makes the platform's own presence a claim this process can rely on.
 *
 * The URL's protocol is the fallback for a direct connection, and it is what
 * makes local `http://127.0.0.1:3939` return false — which it must, or the
 * browser discards the cookie and login appears to succeed while nothing
 * persists.
 */
export function secureCookies(req: Request): boolean {
  if (hostedPlatform(process.env) !== null) return true;
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The login throttle.
 *
 * ## One global counter, not one per caller
 *
 * The obvious design keys on the client address, and it is wrong here. On every
 * platform this feature exists for, requests arrive from the platform's proxy —
 * so "the client address" means reading `x-forwarded-for`, which is set by
 * whoever is calling. A throttle you reset by changing a header is not a
 * throttle. One counter for the whole process cannot be evaded that way, and
 * with a single operator the cost of the trade is that a legitimate login may
 * have to wait a few seconds after somebody else's guessing spree — which is the
 * correct thing to happen.
 *
 * ## What it is not
 *
 * Per-process and in-memory, so it does not survive a redeploy and does not
 * coordinate across replicas. Stated plainly rather than hidden, for the same
 * reason `spend.ts` states its own limit: it is a **delay, not a lockout**, and
 * the thing actually resisting a guessing attack is `MIN_PASSWORD_LENGTH`
 * together with PBKDF2. Nobody should read this and conclude the password can be
 * short.
 *
 * Three free attempts, then a doubling delay capped at five minutes. Three
 * because a typo should not cost anything, and a cap because an unbounded one
 * locks the operator out of their own console permanently on a process that
 * happens to be long-lived.
 */
const FREE_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 5 * 60 * 1000;

export function attempt(): { allowed: boolean; retryAfterMs: number } {
  const s = state();
  const remaining = s.lockedUntil - Date.now();
  return remaining > 0
    ? { allowed: false, retryAfterMs: remaining }
    : { allowed: true, retryAfterMs: 0 };
}

export function attemptFailed(): void {
  const s = state();
  s.failures += 1;
  if (s.failures <= FREE_ATTEMPTS) return;
  const steps = s.failures - FREE_ATTEMPTS - 1;
  s.lockedUntil = Date.now() + Math.min(BASE_DELAY_MS * 2 ** steps, MAX_DELAY_MS);
}

export function attemptSucceeded(): void {
  const s = state();
  s.failures = 0;
  s.lockedUntil = 0;
}

/**
 * Test seams, matching `__resetConfigCache` in `config.ts`. Never called in
 * production.
 *
 * Two of them, and the split is about cost rather than tidiness. Deriving a key
 * is deliberately expensive — 210k PBKDF2 rounds, roughly 100ms — so a suite
 * that cleared the memo between every case paid that per test and pushed itself
 * toward the 5s default timeout under parallel load. The throttle is what a
 * login test actually needs to reset; the key is keyed on the password and is
 * re-derived on its own the moment that changes.
 */
export function __resetThrottle(): void {
  const s = state();
  s.failures = 0;
  s.lockedUntil = 0;
}

export function __resetAuth(): void {
  const holder = globalThis as unknown as Record<symbol, AuthState | undefined>;
  holder[STATE] = undefined;
}
