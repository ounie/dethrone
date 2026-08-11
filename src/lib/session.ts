/**
 * The session token, as a pure function.
 *
 * ## What this is, and what it is emphatically not
 *
 * It is a **lock on the front door of a single-tenant console**. One password,
 * one operator, no user table, no roles, no second person who can spend.
 *
 * `CLAUDE.md`'s third rule bars *multi-user*, and it is worth stating plainly
 * why a login does not breach it, because the next reader will wonder. What is
 * added here is **one** password rather than per-user credentials, and a
 * **stateless** cookie: no table, no user id, no server-side record, no
 * revocation list, and nothing in the token that names a subject. Two people
 * who know the password are two people at one keyboard — exactly as two of the
 * operator's own keys are one person holding several keys.
 *
 * What *would* breach the rule, and must not be built on top of this: a
 * per-session wallet selection, a per-session ceiling, a users list, or a "who
 * is logged in" readout. All four turn a door into a tenancy.
 *
 * ## Why it exists
 *
 * `paidCommandsAllowedFrom` in `config.ts` answers a different question — *where
 * is this request from* — and that question has no useful answer on a long-lived
 * container platform. There the Host is a public domain, `isServerless()` is
 * false, and the only way to make a paid command work at all was
 * `CONSOLE_ALLOW_REMOTE=true`, which switches the host gate off entirely. That
 * combination is README option D with extra steps. Assertion 11 in
 * `assertions.ts` now refuses to start it without a password.
 *
 * ## Why this file is pure, and `auth.ts` is not
 *
 * The same split as `assertions.ts` / `config.ts`, for the same payoff: nothing
 * here reads `process.env`, holds state, or memoizes, so `test/session.test.ts`
 * is a table with no process to poison and no module cache to reset. Every
 * secret arrives as an argument.
 *
 * It also **imports nothing at all**, which is the stronger property: a module
 * with no import edges cannot acquire a path to `wallet.ts`, and `deps.test.ts`
 * does not have to take anyone's word for it.
 *
 * The impure half — reading `CONSOLE_PASSWORD`, memoizing the derived key,
 * holding the login throttle — is `auth.ts`, which is `server-only`.
 *
 * ## Why the bundle scanner cannot help here
 *
 * `scripts/scan-bundle.ts` finds secrets by *shape* — 32 bytes of hex, an `sk-`
 * prefix, a 65-byte signature. An operator-chosen password has no shape, so no
 * scanner will ever find one in a bundle, and pretending otherwise would be
 * worse than saying so. Two structural guards stand in for it: assertion 6's
 * name regex refuses a `NEXT_PUBLIC_…PASSWORD` at build time, which is when the
 * inlining happens, and nothing under `src/components/` imports `auth.ts`.
 */

/**
 * The cookie name. Deliberately not the generic `session` — that collides with
 * anything else served from `localhost` on a shared development machine.
 */
export const SESSION_COOKIE = "dethrone_console_session";

/**
 * Thirty days, renewed on each login.
 *
 * The lever that actually revokes is not this number: it is the password.
 * Because the signing key is derived from `CONSOLE_PASSWORD` (see
 * `sessionKey`), changing that variable invalidates every live cookie at once,
 * everywhere, with no table to clear. That is the logout-everywhere control,
 * and it is what makes a long expiry defensible rather than merely convenient.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The shortest password this console will accept.
 *
 * Twelve, and the reasoning is worth recording because the reflex number is
 * eight. This is the only thing between a public URL and a wallet that can
 * spend. The throttle in `auth.ts` is per-process and best-effort — it slows a
 * guesser, it does not stop one — and PBKDF2 raises the cost of an *offline*
 * attack but not of an online one. So the length is the part actually doing the
 * work, and eight characters of anything memorable is inside a wordlist.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * PBKDF2 iterations, and why this is not a plain SHA-256.
 *
 * The first version of this file used `HMAC(SHA256(password), payload)`. That
 * derivation is fast by design, which is exactly wrong here: anyone who ever
 * sees one valid cookie — a proxy log, a browser extension, a screenshot of dev
 * tools — can brute-force an operator-chosen password **offline**, at hashing
 * speed, against a value they hold. A stretched KDF moves that by five orders of
 * magnitude while keeping the property the design actually wanted, which is that
 * the key is a pure function of the password and nothing else.
 *
 * The count matches OWASP's current PBKDF2-HMAC-SHA256 guidance. The cost is
 * paid once per process, because `auth.ts` memoizes the resulting key rather
 * than the verification.
 */
const PBKDF2_ITERATIONS = 210_000;

/**
 * A fixed salt, which is the right call here and the wrong call almost anywhere
 * else.
 *
 * A per-user random salt exists to stop one precomputed table from breaking
 * many users' passwords at once. There is exactly one password on one deploy,
 * so there is no "many" to protect — and a random salt would have to be stored
 * somewhere, which is the session table this design does not have. What remains
 * is the iteration count, which is the part that matters against a single
 * target. The version suffix is there so a future change to this scheme
 * invalidates old cookies rather than silently accepting them.
 */
const PBKDF2_SALT = "dethrone-console/session/v1";

/** The token format, so a change to the scheme cannot be mistaken for a forgery. */
const TOKEN_VERSION = "v1";

/**
 * Whether a request may proceed.
 *
 * Three states and not two, because `"not-required"` is a different fact from
 * `"valid"` and the difference is load-bearing in `paidCommandsAllowedFrom`: a
 * deploy with no password configured has not authenticated anybody, and must not
 * be allowed to stand in for one that has.
 */
export type SessionState = "not-required" | "valid" | "invalid";

/**
 * Why a token was rejected.
 *
 * A reason rather than a boolean so `test/session.test.ts` can pin each failure
 * mode separately — an expired token and a forged one are different events, and
 * a test that cannot tell them apart would pass against a `verify` that returned
 * false unconditionally.
 *
 * **It is not returned to a caller.** `/api/session` answers identically for
 * every one of these; see the route's comment on why an oracle is the thing to
 * avoid.
 */
export type VerifyResult = "valid" | "absent" | "malformed" | "expired" | "bad-signature";

const encoder = new TextEncoder();

/**
 * The HMAC key for a password.
 *
 * Deriving it from the password rather than from a second `CONSOLE_SESSION_SECRET`
 * is deliberate, and the reason is not brevity. A separate secret would decouple
 * the cookie from the password, so changing the password would leave every
 * existing session alive — and the operator would have no way to end one. One
 * derived from the other is what makes a password change a revocation.
 *
 * Expensive on purpose. Call it once and keep the key; `auth.ts` does.
 */
export async function sessionKey(password: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(PBKDF2_SALT),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    256,
  );
  return crypto.subtle.importKey("raw", bits, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array | null {
  if (value === "" || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * Constant-time byte comparison.
 *
 * The loop accumulates rather than returning early. A fast-exit version is a
 * timing oracle that reveals a signature one byte at a time, and the failure
 * would be invisible in a green test suite forever.
 */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sign(key: CryptoKey, payload: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

/**
 * A fresh token.
 *
 * The payload is a version, an expiry, and a nonce. There is nothing else to put
 * in it: this console has one operator, so a subject claim would be a constant —
 * and a constant in a token is decoration that invites the next reader to start
 * trusting it as though it were checked.
 *
 * The nonce makes two logins produce different tokens. Nothing depends on that
 * today; it costs sixteen bytes and means a token is never a stable identifier
 * for "the operator", which is the property that would otherwise tempt someone
 * to log against it.
 *
 * `nowMs` and `ttlMs` are parameters so a test can mint an already-expired token
 * without waiting thirty days for one.
 */
export async function mint(
  key: CryptoKey,
  nowMs: number,
  ttlMs: number = SESSION_TTL_MS,
): Promise<string> {
  const expiry = String(nowMs + ttlMs);
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `${TOKEN_VERSION}.${expiry}.${nonce}`;
  return `${payload}.${base64url(await sign(key, payload))}`;
}

/**
 * Whether a token is one this key issued and has not expired.
 *
 * The expiry is checked *before* the signature and that ordering is deliberate:
 * an expired-but-genuine token and an expired forgery are the same event to
 * every caller, and doing the cheap check first avoids a PBKDF2-backed HMAC on
 * garbage. The signature is still verified for every token that is in date, so
 * nothing is trusted on the strength of the expiry alone.
 */
export async function verify(
  key: CryptoKey,
  token: string | undefined | null,
  nowMs: number,
): Promise<VerifyResult> {
  if (!token) return "absent";

  const parts = token.split(".");
  if (parts.length !== 4) return "malformed";
  const [version, expiry, nonce, signature] = parts;

  if (version !== TOKEN_VERSION) return "malformed";
  // Anchored digits only, and bounded. `Number("1e999")` is Infinity and
  // `Number(" 1 ")` is 1 — either would turn a malformed token into one that
  // never expires.
  if (!/^\d{1,15}$/.test(expiry)) return "malformed";
  if (!/^[A-Za-z0-9_-]+$/.test(nonce)) return "malformed";

  if (Number(expiry) <= nowMs) return "expired";

  const offered = fromBase64url(signature);
  if (offered === null) return "malformed";

  const expected = await sign(key, `${version}.${expiry}.${nonce}`);
  return equalBytes(offered, expected) ? "valid" : "bad-signature";
}

/**
 * Whether an offered password is the configured one.
 *
 * Double-HMAC rather than `offered === expected`. String equality
 * short-circuits at the first differing character, which is a timing oracle
 * that leaks a password one character at a time; Node's `timingSafeEqual` is
 * not available on every runtime this may be called from. Signing both with the
 * session key makes every comparison the same 32 bytes, and an attacker cannot
 * precompute either side without the key — which they cannot have, since it is
 * derived from the password they are trying to guess.
 */
export async function passwordMatches(
  key: CryptoKey,
  offered: string,
  expected: string,
): Promise<boolean> {
  const [a, b] = await Promise.all([sign(key, offered), sign(key, expected)]);
  return equalBytes(a, b);
}

/**
 * One cookie's value out of a raw `Cookie` header.
 *
 * Hand-parsed rather than via `next/headers`, because the route handlers already
 * hold the `Request` and this file imports nothing. Splitting on the *first* `=`
 * matters: base64url leaves no padding, but a value that kept some would be
 * truncated by a naive `split("=")`.
 */
export function cookieValue(
  header: string | null | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    return trimmed.slice(eq + 1);
  }
  return undefined;
}

/**
 * The `Set-Cookie` value for a login.
 *
 * `HttpOnly` so no script can read it. `SameSite=Strict` so a cross-site POST
 * cannot carry it — which is this console's CSRF story for the four routes that
 * spend, and worth naming as such: without it a page on another origin could
 * POST to `/api/act` and the browser would helpfully attach the session.
 *
 * `Secure` is a parameter rather than a constant because both settings break
 * something. Hard-coded on, the cookie is silently discarded over plain HTTP, so
 * `pnpm dev` on `http://127.0.0.1:3939` logs in successfully and stays logged
 * out — which reads as a server bug and is a configuration one. Hard-coded off,
 * a hosted deploy sends its session over any downgrade. `auth.ts` decides, from
 * the platform rather than from a header the caller controls.
 */
export function setCookie(token: string, opts: { secure: boolean; ttlMs?: number }): string {
  const maxAge = Math.floor((opts.ttlMs ?? SESSION_TTL_MS) / 1000);
  const attrs = [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAge}`];
  if (opts.secure) attrs.push("Secure");
  return attrs.join("; ");
}

/** The `Set-Cookie` value for a logout. Same attributes, so the browser matches it. */
export function clearCookie(opts: { secure: boolean }): string {
  const attrs = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (opts.secure) attrs.push("Secure");
  return attrs.join("; ");
}
