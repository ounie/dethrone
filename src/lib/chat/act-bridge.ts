import "server-only";
import { POST as actPost } from "@/app/api/act/route";

/**
 * The only way the agent reaches the arena: through `/api/act`'s own handler.
 *
 * ## Why a function call and not a fetch
 *
 * Two reasons, and the second is the one that matters.
 *
 * The mechanical one: `fetch` inside a route handler needs an absolute URL, and
 * `test/one-fetch.test.ts` only recognises a *string literal* as an own-route
 * target. Any URL built from the request origin reads as `<dynamic>` and fails
 * the "every fetch targets the console's own route" assertion — correctly, since
 * a dynamic fetch target is exactly the thing that assertion exists to catch.
 *
 * The real one: invoking the handler directly means every gate in
 * `app/api/act/route.ts` runs, in the order that file documents, with no
 * opportunity for this module to skip one. There is no second copy of the
 * ceiling check, the confirmation, the interface pin or the host check — there
 * is the one copy, and the agent goes through it exactly as a button does.
 *
 * ## The Host header is copied, never synthesised
 *
 * This is the most dangerous line in the whole feature, so it is the one with
 * the longest comment.
 *
 * `new Request()` requires an absolute URL, which makes it *convenient* to
 * write `host: "127.0.0.1"` and move on. Doing so would be a hole straight
 * through assertion 3: `/api/act` re-derives the host from the request
 * precisely because a boot-time check usually cannot see the bind, and it is
 * that per-request check — not the boot one — that refuses paid commands off
 * loopback. A bridge that forged loopback would turn a chat pane on a reachable
 * deploy into a paid-command path that a direct POST to `/api/act` would have
 * refused.
 *
 * So the origin request's `host` and `x-forwarded-host` are passed through
 * unchanged, and `test/chat-route.test.ts` posts from `evil.example` to prove a
 * paid tool comes back `CONSOLE_REMOTE_HOST`.
 */

export interface ActInvocation {
  id: string;
  args: Record<string, string>;
  /**
   * Echoed from a 428 the route itself produced. Never composed here — see
   * `execute.ts`, which reads it out of the refusal rather than computing it.
   */
  confirm?: { amountCents: number; payer: string };
  /** Tightens the route's confirmation threshold. It can never loosen it. */
  confirmOverCents?: number;
}

export interface ActResponse {
  status: number;
  body: Record<string, unknown>;
}

export async function callAct(origin: Request, invocation: ActInvocation): Promise<ActResponse> {
  const headers = new Headers({ "content-type": "application/json" });

  // Verbatim. Not defaulted, not normalised, not invented.
  const host = origin.headers.get("host");
  if (host !== null) headers.set("host", host);
  const forwarded = origin.headers.get("x-forwarded-host");
  if (forwarded !== null) headers.set("x-forwarded-host", forwarded);

  const url = new URL("/api/act", new URL(origin.url).origin);
  const res = await actPost(
    new Request(url, { method: "POST", headers, body: JSON.stringify(invocation) }),
  );

  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}
