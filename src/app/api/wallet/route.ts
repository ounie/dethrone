import { NextResponse } from "next/server";
import { z } from "zod";
import { autonomyStore } from "@/lib/chat/autonomy";
import { authenticate } from "@/lib/auth";
import { config, paidCommandsAllowedFrom } from "@/lib/config";
import { consoleError, type ConsoleErrorCode } from "@/lib/errors";
import { address, select, selectedWalletId, wallets } from "@/lib/wallet";

/**
 * Point the console at a different configured wallet.
 *
 * ## Why a fourth route is allowed here
 *
 * The one-door invariant is about the **canon**: exactly one module may reach
 * `DETHRONE_BASE_URL`, because that is where a payment can be attached, a
 * signature minted, or a spend go uncounted. This route makes no outbound
 * request at all — it moves a pointer in this process's memory. It holds no
 * key, mints no signature, and cannot attach a payment.
 * `test/wallet-route.test.ts` pins each of those rather than assuming them.
 *
 * ## Why the selection is here and not in the request that spends
 *
 * The whole reason this route exists is that **which wallet pays must not be a
 * field on `/api/act`**. That is the argument `chat/autonomy.ts` makes about the
 * grant, and it applies harder to a payer: anything the browser can assert,
 * anything that can POST can assert. So the choice is made once, deliberately,
 * through a door with its own gates — and `/api/act` reads the answer rather
 * than being told it.
 *
 * ## The host gate, which is NOT redundant
 *
 * `/api/ceiling` has no loopback check and this one does. The difference is
 * blast radius, and it is worth stating so nobody removes the gate as
 * inconsistent. `/api/ceiling` earns its exemption honestly: the only thing it
 * can do to the world is make the console *less* able to spend. This route does
 * not have that property. Without it, whatever can reach a remote deploy's
 * `/api/act` can spend **the selected wallet**; with it, that same caller can
 * spend **all of them**. That is money-shaped even though no cents are named
 * here, so it earns the same check a paid command gets.
 *
 * On the documented local deploy the gate never fires. Under
 * `CONSOLE_ALLOW_REMOTE` it is a no-op by the operator's explicit choice, and on
 * serverless assertions 4 and 5 have already demanded an acknowledged,
 * protected deployment.
 *
 * ## No lock, and no refusal while something is in flight
 *
 * There is deliberately no "a command is running, try again". `sign.ts` and
 * `pay.ts` both resolve the account synchronously before their first `await`
 * and close over it, so a switch landing mid-request cannot change who pays for
 * a request already under way — the race a lock would guard cannot happen, and
 * a lock would add a real failure mode (a wedged console, on the transport
 * replay path, if a release is ever missed) to prevent it.
 *
 * A live autonomy grant does not block the switch either. The operator's intent
 * is "act as this other wallet now", and the safe answer to that is not "no" —
 * it is "yes, and the machine loses its permission". Refusing would put the
 * friction on the *safe* direction of travel, which inverts the asymmetry the
 * ceiling and the grant are both built on.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ id: z.string().min(1).max(64) });

function fail(code: ConsoleErrorCode, detail?: Record<string, unknown>): NextResponse {
  const { status, body } = consoleError(code, detail);
  return NextResponse.json(body, { status });
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    config();
  } catch (err) {
    return fail("CONSOLE_MISCONFIGURED", {
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  /*
    The door, above the parse and above both gates below.

    That ordering fixes something inherited rather than merely adding to it: as
    written, an anonymous caller learned from `CONSOLE_NO_WALLET` whether this
    deploy holds a key, and got the configured wallets' labels, BEFORE the host
    check ever ran. Neither is a thing to hand out.
  */
  const session = await authenticate(req);
  if (session === "invalid") return fail("CONSOLE_UNAUTHENTICATED");

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("CONSOLE_BAD_FIELD", { field: "id" });

  const choices = wallets();
  if (choices.length === 0) return fail("CONSOLE_NO_WALLET");

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!paidCommandsAllowedFrom(host, session)) return fail("CONSOLE_REMOTE_HOST", { host });

  const wanted = choices.find((w) => w.id === parsed.data.id);
  if (!wanted) return fail("CONSOLE_UNKNOWN_WALLET", { id: parsed.data.id });

  /*
    Revoke first, select second, and the order is load-bearing.

    A grant names an address in the sentence the operator read, so it cannot
    follow them to a different wallet. `autonomy.ts`'s `read()` drops a grant
    whose operator no longer matches, which is the backstop; this is the
    deliberate half, and it runs against the OUTGOING operator because that is
    whose grant exists.

    Revoke-then-select leaves the safe state if anything between them throws.
    Select-then-revoke would leave a live grant belonging to a wallet that is no
    longer signing, and only the backstop would catch it.
  */
  const outgoing = address();
  const store = autonomyStore(outgoing);
  const revoked = store.read() !== null;
  store.revoke();

  select(wanted.id);

  return NextResponse.json({
    selected: wanted,
    wallets: choices,
    /**
     * Said out loud so the chat pane can report it. An agent that silently
     * stops acting looks broken; one that says why does not.
     */
    autonomyRevoked: revoked,
    selectedId: selectedWalletId(),
  });
}
