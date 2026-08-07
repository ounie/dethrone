import { ERROR_CODES } from "./interface";

/**
 * The console's own refusals.
 *
 * ## Why a separate namespace
 *
 * Every code here means *the console stopped this before it reached the arena*.
 * Every code in `interface.ts` means *the arena answered*. Those are different
 * facts with different consequences — one of them may have cost money — and a
 * client that cannot tell them apart will eventually report a local seatbelt as
 * a game rule.
 *
 * So the sets are disjoint by construction, prefixed `CONSOLE_`, and
 * `test/errors.test.ts` asserts the intersection is empty. If the canon ever
 * mints a code beginning `CONSOLE_`, that test fails and one of us renames.
 */
export const CONSOLE_ERROR_CODES = [
  /** An assertion failed and a request somehow got in. Unreachable in practice. */
  "CONSOLE_MISCONFIGURED",
  /** `id` is not in the catalogue. */
  "CONSOLE_UNKNOWN_COMMAND",
  /** A paid or signed command with no key. Read-only mode. */
  "CONSOLE_NO_WALLET",
  /** A required `:segment` or body field was empty. No request was made. */
  "CONSOLE_MISSING_FIELD",
  /** A numeric field that is not a number. */
  "CONSOLE_BAD_FIELD",
  /** Above the confirm threshold, or caller-priced, with no matching confirmation. */
  "CONSOLE_CONFIRM_REQUIRED",
  /** The local ceiling would be exceeded. No request left the process. */
  "CONSOLE_SPEND_CAP",
  /** The 402's offer exceeded the operator's maximum. **Nothing was signed.** */
  "CONSOLE_PRICE_ABOVE_MAX",
  /** A paid command from a host that is not loopback, without CONSOLE_ALLOW_REMOTE. */
  "CONSOLE_REMOTE_HOST",
  /** The arena reports an interface this console was not written against. */
  "CONSOLE_INTERFACE_MISMATCH",
  /** This command is not registered on this deploy (e.g. genesis without the flag). */
  "CONSOLE_COMMAND_DISABLED",
  /**
   * The transport died *after* a payment payload was signed, and the single
   * identical replay also failed. The authorization may or may not have settled.
   * **Re-read the canon. Do not re-run this command** — a fresh signature is a
   * second payment.
   */
  "CONSOLE_PAYMENT_INFLIGHT",
  /** DNS, connect or timeout. Nothing was signed and nothing settled. */
  "CONSOLE_TRANSPORT",
] as const;

export type ConsoleErrorCode = (typeof CONSOLE_ERROR_CODES)[number];

/**
 * Status per code. Two are worth a second look:
 *
 * `CONSOLE_CONFIRM_REQUIRED` is **428 Precondition Required** rather than 400,
 * because the request was well-formed and the missing thing is a precondition
 * the client can supply and retry with. That is precisely what 428 is for, and
 * it makes the confirmation a protocol step rather than a UI habit.
 *
 * `CONSOLE_SPEND_CAP` is 429, matching the canon's `RATE_LIMITED`: a limit was
 * hit, the request was fine, and waiting (here, restarting the sitting) changes
 * the answer.
 */
export const CONSOLE_ERROR_STATUS: Record<ConsoleErrorCode, number> = {
  CONSOLE_MISCONFIGURED: 500,
  CONSOLE_UNKNOWN_COMMAND: 400,
  CONSOLE_NO_WALLET: 400,
  CONSOLE_MISSING_FIELD: 400,
  CONSOLE_BAD_FIELD: 400,
  CONSOLE_CONFIRM_REQUIRED: 428,
  CONSOLE_SPEND_CAP: 429,
  CONSOLE_PRICE_ABOVE_MAX: 409,
  CONSOLE_REMOTE_HOST: 403,
  CONSOLE_INTERFACE_MISMATCH: 409,
  CONSOLE_COMMAND_DISABLED: 409,
  CONSOLE_PAYMENT_INFLIGHT: 502,
  CONSOLE_TRANSPORT: 502,
};

/**
 * A one-line English gloss per code.
 *
 * These are for a human reading the response pane. They are not a contract and
 * nothing parses them — the console renders the *code* as the headline and this
 * as the subtitle, in that order, because English drifts and codes don't.
 */
export const CONSOLE_ERROR_ENGLISH: Record<ConsoleErrorCode, string> = {
  CONSOLE_MISCONFIGURED: "The console's own configuration failed its assertions.",
  CONSOLE_UNKNOWN_COMMAND: "No command with that id exists in the catalogue.",
  CONSOLE_NO_WALLET:
    "Read-only mode. Set DETHRONE_PRIVATE_KEY in .env.local and restart to sign or pay.",
  CONSOLE_MISSING_FIELD: "A required field was empty. No request was made.",
  CONSOLE_BAD_FIELD: "A numeric field was not a number. No request was made.",
  CONSOLE_CONFIRM_REQUIRED:
    "This command moves money. Confirm the amount and the paying address to proceed.",
  CONSOLE_SPEND_CAP:
    "The local spend ceiling for this sitting would be exceeded. No request left the process.",
  CONSOLE_PRICE_ABOVE_MAX:
    "The arena quoted more than the maximum you set. Nothing was signed and nothing was paid.",
  CONSOLE_REMOTE_HOST:
    "Paid commands are refused off loopback. Set CONSOLE_ALLOW_REMOTE=true only if you meant this.",
  CONSOLE_INTERFACE_MISMATCH:
    "The arena reports a different interface version. Reads still work; nothing will spend.",
  CONSOLE_COMMAND_DISABLED: "This command is not registered on this deploy.",
  CONSOLE_PAYMENT_INFLIGHT:
    "The connection died after a payment was signed. Re-read the canon before doing anything else — do not re-run this command.",
  CONSOLE_TRANSPORT: "The arena could not be reached. Nothing was signed.",
};

export interface ConsoleErrorBody {
  error: {
    code: ConsoleErrorCode;
    message: string;
    detail?: Record<string, unknown>;
  };
}

export function consoleError(
  code: ConsoleErrorCode,
  detail?: Record<string, unknown>,
): { status: number; body: ConsoleErrorBody } {
  return {
    status: CONSOLE_ERROR_STATUS[code],
    body: {
      error: {
        code,
        message: CONSOLE_ERROR_ENGLISH[code],
        ...(detail ? { detail } : {}),
      },
    },
  };
}

/** Used by the drift test. Exported so the assertion reads as one line. */
export function namespacesAreDisjoint(): boolean {
  const canon: ReadonlySet<string> = new Set(ERROR_CODES);
  return CONSOLE_ERROR_CODES.every((c) => !canon.has(c));
}
