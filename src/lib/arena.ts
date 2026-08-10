import "server-only";
import { config } from "./config";
import { INTERFACE_HEADER, INTERFACE_VERSION } from "./interface";
import { payingFetch, readSettlement, type PayAttempt, type Settlement } from "./pay";
import { address } from "./wallet";

/**
 * The single door to the canon.
 *
 * **Exactly one module in this tree constructs a URL against
 * `DETHRONE_BASE_URL` and calls `fetch` on it, and this is that module.**
 * `test/one-fetch.test.ts` fails on a second. The rule is not tidiness: a
 * second call site is a second place where a payment can be attached, a
 * signature can be minted, or a spend can go uncounted, and the whole safety
 * argument of this console rests on there being one.
 */

export interface ArenaResult {
  status: number;
  ok: boolean;
  ms: number;
  body: unknown;
  /** The interface version the arena stamped on this response, if any. */
  interfaceVersion: string | null;
  /**
   * True when the response is the canon's own 404 rather than a missing route.
   *
   * Every `/api/*` response — success or refusal — carries
   * `X-Dethrone-Interface`, and every kill switch answers with the canon's
   * `NOT_FOUND` envelope. So a 404 *with* the header means the route exists and
   * the feature is off; a 404 *without* it means this server has no such route.
   * Two different sentences for the operator, derived from a header, with no
   * rule invented.
   */
  featureDisabled: boolean;
  settlement: Settlement | null;
}

export interface ArenaRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Pathname with segments already encoded. */
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  paid: boolean;
  /** `min(remaining ceiling, operator's maximum)`. Null when the price is known. */
  maxCents?: number | null;
}

export interface ArenaOutcome {
  result: ArenaResult | null;
  attempt: PayAttempt;
  /** Set when nothing was ever received. */
  transportError?: Error;
}

function url(path: string, query?: Record<string, string>): string {
  const base = config().baseUrl + path;
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== "") params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

async function parse(res: Response): Promise<unknown> {
  // Read as text and parse conditionally: a 204 must yield null, not a syntax
  // error blamed on the server.
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toResult(res: Response, body: unknown, ms: number): ArenaResult {
  const interfaceVersion = res.headers.get(INTERFACE_HEADER);
  return {
    status: res.status,
    ok: res.ok,
    ms,
    body,
    interfaceVersion,
    featureDisabled: res.status === 404 && interfaceVersion !== null,
    settlement: readSettlement(res),
  };
}

export async function call(req: ArenaRequest): Promise<ArenaOutcome> {
  const cfg = config();
  const t0 = Date.now();

  const headers: Record<string, string> = {
    accept: "application/json",
    ...(req.body !== undefined ? { "content-type": "application/json" } : {}),
    ...req.headers,
  };

  let doFetch: typeof fetch = fetch;
  let attempt: PayAttempt = {};

  if (req.paid) {
    if (cfg.devBypass) {
      // The local dev bypass. Gated at boot to loopback base URLs, and it
      // produces no settlement receipt — which is exactly why `settled` is
      // computed from the receipt and not from `res.ok`.
      //
      // This resolves the selected wallet independently of `/api/act`, which
      // hoists one `address()` for its whole handler. They cannot disagree
      // today (nothing awaits between the two reads on any real path) and no
      // money moves down this branch in any case. Threading the operator
      // through `ArenaRequest` would make the property structural rather than
      // circumstantial, and is worth doing if this branch ever grows.
      const me = address();
      if (me) headers["x-dev-wallet"] = me;
    } else {
      const paying = payingFetch(cfg.network, req.maxCents ?? null);
      doFetch = paying.fetch;
      attempt = paying.attempt;
    }
  }

  try {
    const res = await doFetch(url(req.path, req.query), {
      method: req.method,
      headers,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      cache: "no-store",
    });
    return { result: toResult(res, await parse(res), Date.now() - t0), attempt };
  } catch (err) {
    return {
      result: null,
      attempt,
      transportError: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * The single permitted retry: resend the identical captured payload, once.
 *
 * This exists only for the case where the transport died after a payload was
 * signed. It uses plain `fetch` and never re-enters the payment wrapper, so it
 * is structurally incapable of minting a second signature. If it also fails,
 * the caller reports `CONSOLE_PAYMENT_INFLIGHT` and tells the operator to
 * re-read the canon rather than to try again.
 */
export async function replay(req: ArenaRequest, capturedSignature: string): Promise<ArenaOutcome> {
  const t0 = Date.now();
  try {
    const res = await fetch(url(req.path, req.query), {
      method: req.method,
      headers: {
        accept: "application/json",
        ...(req.body !== undefined ? { "content-type": "application/json" } : {}),
        ...req.headers,
        "payment-signature": capturedSignature,
      },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      cache: "no-store",
    });
    return { result: toResult(res, await parse(res), Date.now() - t0), attempt: {} };
  } catch (err) {
    return {
      result: null,
      attempt: {},
      transportError: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export function interfaceMatches(version: string | null): boolean {
  return version === null || version === INTERFACE_VERSION;
}
