import { NextResponse } from "next/server";
import { z } from "zod";
import {
  attempt,
  attemptFailed,
  attemptSucceeded,
  checkPassword,
  issue,
  passwordRequired,
  revoke,
  secureCookies,
} from "@/lib/auth";
import { consoleError, type ConsoleErrorCode } from "@/lib/errors";

/**
 * The door itself: the one route reachable without a session.
 *
 * ## What it cannot do
 *
 * It holds no wallet key, makes no outbound request, mints no signature, and
 * cannot attach a payment. It imports nothing from `arena.ts`, `pay.ts` or
 * `sign.ts` — `test/one-fetch.test.ts` asserts that structurally for every
 * own-route that is not `/api/act`. All it does is compare a string and set a
 * cookie.
 *
 * ## It answers identically for every failure
 *
 * A wrong password, an absent one, and a malformed body all return the same
 * `CONSOLE_UNAUTHENTICATED` with no detail, and all three count against the
 * throttle. Anything else is an oracle: a route that distinguishes "no password
 * supplied" from "wrong password" tells a caller their request shape was right,
 * and one that distinguishes a near-miss tells them far more. `verify()` in
 * `session.ts` returns a *reason* precisely so the tests can pin each case —
 * this route deliberately throws that detail away.
 *
 * The one exception is `CONSOLE_AUTH_DISABLED`, and it leaks nothing: a deploy
 * with no password has no secret to protect, and the login page needs to know so
 * it can redirect rather than render a form that cannot do anything.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `max(512)` bounds the work, not the operator. There is no upper limit on a
 * sensible password, but there is on one worth running PBKDF2 against, and a
 * megabyte of submitted "password" should be refused before it is hashed.
 */
const schema = z.object({ password: z.string().min(1).max(512) });

function fail(code: ConsoleErrorCode, detail?: Record<string, unknown>): NextResponse {
  const { status, body } = consoleError(code, detail);
  return NextResponse.json(body, { status });
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!passwordRequired()) return fail("CONSOLE_AUTH_DISABLED");

  // Before the parse and before the comparison, so a guesser cannot spend this
  // process's CPU on PBKDF2 at their own chosen rate.
  const gate = attempt();
  if (!gate.allowed) {
    return NextResponse.json(consoleError("CONSOLE_TOO_MANY_ATTEMPTS").body, {
      status: 429,
      headers: { "retry-after": String(Math.ceil(gate.retryAfterMs / 1000)) },
    });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    // A malformed body counts as a failed attempt. It is the cheapest way to
    // probe for a rate limiter, and treating it as free would make the throttle
    // trivially avoidable by sending nonsense between guesses.
    attemptFailed();
    return fail("CONSOLE_UNAUTHENTICATED");
  }

  if (!(await checkPassword(parsed.data.password))) {
    attemptFailed();
    return fail("CONSOLE_UNAUTHENTICATED");
  }

  attemptSucceeded();
  const cookie = await issue(secureCookies(req));
  if (cookie === null) return fail("CONSOLE_AUTH_DISABLED");

  // `{ ok: true }` and nothing else. In particular the response never echoes
  // what was submitted — an error body that quoted the offered password would
  // put it in a browser's network log, which is where secrets go to be found.
  return NextResponse.json({ ok: true }, { headers: { "set-cookie": cookie } });
}

/**
 * Log out.
 *
 * Clearing the cookie is the whole of it, because there is nothing server-side
 * to clear — the token is stateless by design, so this ends the session on this
 * browser and nowhere else. The lever that ends *every* session everywhere is
 * changing `CONSOLE_PASSWORD`, which re-derives the signing key and invalidates
 * every token ever minted. That is worth knowing rather than discovering: a
 * cookie copied off this machine before logout still verifies until it expires
 * or the password changes.
 *
 * Unauthenticated on purpose. Requiring a valid session to log out means a
 * browser holding a token this deploy no longer honours has no way to tidy up
 * after itself, and refusing to clear a cookie protects nobody.
 */
export async function DELETE(req: Request): Promise<NextResponse> {
  return NextResponse.json(
    { ok: true },
    { headers: { "set-cookie": revoke(secureCookies(req)) } },
  );
}
