import "server-only";
import { account } from "./wallet";
import { NoWalletError } from "./sign";

/**
 * The x402 handshake. The only module that holds a key and a network in the
 * same breath.
 *
 * It does not call the canon — `arena.ts` does. This file *produces a fetch*
 * and hands it over, which keeps the answer to "how many modules issue a
 * request to `DETHRONE_BASE_URL`" at exactly one.
 *
 * ## The inner wrapper, and the two things it buys
 *
 * `wrapFetchWithPaymentFromConfig` takes a `fetch` to wrap. Wrapping *that* one
 * first puts this module between the payment library and the network, which is
 * the only place two hard requirements can be met:
 *
 * **1. The offer gate.** A caller-priced command — take a duel, buy an heir,
 * book an exhibition — has a price the console cannot know until the 402
 * arrives. Reading the offer here and *removing it* when it exceeds the
 * operator's maximum makes the payment library give up **without signing**. The
 * console has then refused a price rather than paid it and complained
 * afterwards, which is the difference between a seatbelt and a receipt.
 *
 * **2. Retry-identical replay.** The signed payload is captured on its way out.
 * If the transport dies with no HTTP status ever received, the caller may
 * resend that *exact* header once. The EIP-3009 nonce is single-use, so the
 * resend either completes the original request or fails as a replay — it cannot
 * double-charge. Re-signing would be a second payment, so there is no code path
 * here that can produce a second signature for one command.
 */

/** USDC is 6 decimals. One cent is 10_000 atomic units. */
const ATOMIC_PER_CENT = 10_000n;

function caip2(network: string): `${string}:${string}` {
  return network === "mainnet" || network === "base" ? "eip155:8453" : "eip155:84532";
}

export interface PayAttempt {
  /** The x402 payload that went out, if one was ever produced. */
  capturedSignature?: string;
  /** Set when the offer gate refused. Nothing was signed. */
  refusedOffer?: { quotedCents: number; maxCents: number };
}

export interface PayingFetch {
  fetch: typeof fetch;
  attempt: PayAttempt;
}

/**
 * A fetch that answers a 402, bounded by `maxCents`.
 *
 * `maxCents` is `min(what the ceiling still allows, what the operator typed)`.
 * Pass `null` only for a command whose price the catalogue already knows and
 * the ceiling has already checked.
 */
export function payingFetch(network: string, maxCents: number | null): PayingFetch {
  const acct = account();
  if (!acct) throw new NoWalletError();

  const attempt: PayAttempt = {};
  const maxAtomic = maxCents === null ? null : BigInt(maxCents) * ATOMIC_PER_CENT;

  const inner: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    // v2 name first, v1 as the fallback — the same order the server accepts.
    const signature = headers.get("payment-signature") ?? headers.get("x-payment");
    if (signature) attempt.capturedSignature = signature;

    const res = await fetch(input, init);

    if (res.status === 402 && maxAtomic !== null && maxCents !== null) {
      const quoted = readOfferAtomic(res);
      if (quoted !== null && quoted > maxAtomic) {
        attempt.refusedOffer = {
          quotedCents: Number(quoted / ATOMIC_PER_CENT),
          maxCents,
        };
        // Strip the offer so the payment library has nothing to sign against and
        // returns the 402 as-is. This is the whole point: the refusal happens
        // BEFORE a signature exists.
        const blinded = new Headers(res.headers);
        blinded.delete("payment-required");
        return new Response(await res.arrayBuffer(), {
          status: res.status,
          statusText: res.statusText,
          headers: blinded,
        });
      }
    }

    return res;
  };

  // Imported lazily so a read-only session never loads the payment stack.
  // Resolved at call time rather than module scope for the same reason.
  const wrapped: typeof fetch = async (input, init) => {
    const [{ wrapFetchWithPaymentFromConfig }, { ExactEvmScheme }] = await Promise.all([
      import("@x402/fetch"),
      import("@x402/evm/exact/client"),
    ]);
    const pay = wrapFetchWithPaymentFromConfig(inner, {
      schemes: [{ network: caip2(network), client: new ExactEvmScheme(acct) }],
    });
    return pay(input, init);
  };

  return { fetch: wrapped, attempt };
}

/**
 * The quoted price, in atomic USDC, from a 402.
 *
 * The `payment-required` header is authoritative — it is base64 JSON and it is
 * what the reference client reads. The body is documentation of the same offer
 * and is not parsed here.
 */
function readOfferAtomic(res: Response): bigint | null {
  const header = res.headers.get("payment-required");
  if (!header) return null;
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
      accepts?: { amount?: string; maxAmountRequired?: string }[];
    };
    const first = decoded.accepts?.[0];
    const raw = first?.amount ?? first?.maxAmountRequired;
    return raw === undefined ? null : BigInt(raw);
  } catch {
    return null;
  }
}

export interface Settlement {
  success: boolean;
  payer?: string;
  transaction?: string;
}

/**
 * The settlement receipt, read under its v2 name with the v1 name as fallback.
 *
 * A `null` here does **not** mean failure — it means the response carried no
 * receipt, which is what the dev bypass produces. That distinction is why
 * `settled` in the envelope is `paid && ok && settlement?.success === true` and
 * not `paid && ok`: reporting a settlement that did not happen is a lie on a
 * money screen, and it would be told during exactly the step where an operator
 * is learning whether to trust the number.
 */
export function readSettlement(res: { headers: Headers }): Settlement | null {
  const raw =
    res.headers.get("payment-response") ?? res.headers.get("x-payment-response") ?? null;
  if (!raw) return null;
  try {
    const decoded = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
    return {
      success: decoded.success === true,
      payer: typeof decoded.payer === "string" ? decoded.payer : undefined,
      transaction:
        typeof decoded.transaction === "string"
          ? decoded.transaction
          : typeof decoded.txHash === "string"
            ? decoded.txHash
            : undefined,
    };
  } catch {
    return null;
  }
}
