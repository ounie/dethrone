/**
 * A vendored copy of the canon's published interface contract.
 *
 * ## Why vendored rather than imported
 *
 * This console is a separate, public repository. It cannot import from the
 * arena's source, and the arena publishes no client package. So the contract is
 * copied, and the copy carries its provenance so a reader knows what to diff
 * against when something stops matching:
 *
 *   source: apps/web/src/lib/game/interface.ts   (private monorepo)
 *   pinned: interface-v2
 *
 * A copy that silently rots is worse than no copy at all, so nothing here is
 * load-bearing for correctness — it is used to *recognise* codes, never to
 * decide what one means. The console renders `error.code` and lets the operator
 * read it. See `INTERFACE_VERSION` below for the one thing that is enforced.
 */

/**
 * The interface this console was written against.
 *
 * Every `/api/*` response carries `X-Dethrone-Interface`. Paths are unversioned
 * by design: a breaking change mints a new path *and* a new interface version,
 * so this string going stale is the single signal that the console's
 * assumptions have expired.
 *
 * On a mismatch the console disables every paid command and keeps every free
 * read working — it fails closed on money and open on reads, which is the only
 * direction that is safe in both.
 */
export const INTERFACE_VERSION = "interface-v2";

export const INTERFACE_HEADER = "x-dethrone-interface";

/**
 * Every code the canon can emit. Closed, and closed forever: a code is part of
 * the published contract the moment a caller branches on it.
 *
 * Sub-reasons are NOT in this list — a service's typed reason union travels in
 * `detail.reason`, which is what keeps this closed while still saying precisely
 * what went wrong. The console renders both and interprets neither.
 */
export const ERROR_CODES = [
  // Domain: the game refusing, in its own words.
  "SEAT_VESTING",
  "ALREADY_FORGED",
  "FORGE_WINDOW_CLOSED",
  "PROMPT_REJECTED",
  "PROMPT_INVALID",
  "NOT_PARTICIPANT",
  "TOKEN_EXPIRED",
  "TIP_BELOW_MINIMUM",
  "MATCH_NOT_FOUND",
  "ARENA_CLOSED",
  "RATE_LIMITED",

  // Transport: the request never reached the game.
  "BAD_REQUEST",
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "CONFLICT",
  "NOT_BOOKABLE",
  "CAPACITY",
  "PAYMENTS_UNAVAILABLE",
  "INTERNAL",

  // Duels.
  "STAKE_OUT_OF_RANGE",
  "DUEL_ALREADY_TAKEN",
  "DUEL_NOT_CANCELLABLE",
  "NOT_DUEL_HOST",
  "DUELS_CLOSED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

export function isCanonErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && CODE_SET.has(value);
}

export interface CanonErrorBody {
  error: {
    code: string;
    message: string;
    detail?: Record<string, unknown>;
  };
}

export function isCanonErrorBody(body: unknown): body is CanonErrorBody {
  if (typeof body !== "object" || body === null) return false;
  const err = (body as { error?: unknown }).error;
  if (typeof err !== "object" || err === null) return false;
  return typeof (err as { code?: unknown }).code === "string";
}

/**
 * Which refusals are worth retrying, straight from the canon's own table.
 *
 * Rendered as a hint beside the code. It is advice about the *shape* of a
 * failure, not a decision the console makes on the operator's behalf: nothing
 * here retries anything automatically, because a retry that re-signs a payment
 * is a second payment.
 */
export const RETRY_SAFETY: Partial<Record<ErrorCode, "later" | "never" | "after-fixing">> = {
  SEAT_VESTING: "later",
  ALREADY_FORGED: "never",
  FORGE_WINDOW_CLOSED: "never",
  PROMPT_REJECTED: "after-fixing",
  PROMPT_INVALID: "after-fixing",
  NOT_PARTICIPANT: "never",
  TOKEN_EXPIRED: "never",
  TIP_BELOW_MINIMUM: "after-fixing",
  MATCH_NOT_FOUND: "never",
  ARENA_CLOSED: "later",
  RATE_LIMITED: "later",
  BAD_REQUEST: "after-fixing",
  UNAUTHENTICATED: "after-fixing",
  NOT_FOUND: "never",
  CONFLICT: "never",
  NOT_BOOKABLE: "after-fixing",
  CAPACITY: "later",
  PAYMENTS_UNAVAILABLE: "later",
  INTERNAL: "later",
  STAKE_OUT_OF_RANGE: "after-fixing",
  DUEL_ALREADY_TAKEN: "never",
  DUEL_NOT_CANCELLABLE: "never",
  NOT_DUEL_HOST: "never",
  DUELS_CLOSED: "later",
};
