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
  /**
   * `CONSOLE_PASSWORD` is set on this deploy and the request carried no live
   * session cookie. **Nothing was read, nothing was signed, and no body was
   * parsed** — this is the first gate in every route, above the host check and
   * above the JSON parse.
   *
   * Unlike `CONSOLE_REMOTE_HOST` it gates *free* commands too. The page renders
   * the operator's address, balance and spend ledger, so an ungated read is a
   * disclosure even where it cannot spend.
   */
  "CONSOLE_UNAUTHENTICATED",
  /**
   * A login was offered to a deploy that has no `CONSOLE_PASSWORD`. Not an
   * error the operator can act on from the browser — it means the door is not
   * there, and the login page redirects rather than rendering a form that
   * cannot do anything.
   *
   * A separate code from `CONSOLE_COMMAND_DISABLED` because that one's English
   * says "command", and this is not one.
   */
  "CONSOLE_AUTH_DISABLED",
  /**
   * Too many failed logins on this process. A **delay, not a lockout** — see
   * the throttle's comment in `auth.ts`, which is per-process and explicitly
   * not the thing resisting a guessing attack.
   *
   * Not `CONSOLE_SPEND_CAP`, even though both are 429: reusing a money code for
   * a refusal that names no money is exactly the confusion this file's opening
   * paragraph exists to prevent.
   */
  "CONSOLE_TOO_MANY_ATTEMPTS",
  /** The arena reports an interface this console was not written against. */
  "CONSOLE_INTERFACE_MISMATCH",
  /** This command is not registered on this deploy (e.g. genesis without the flag). */
  "CONSOLE_COMMAND_DISABLED",
  /** The ceiling cannot bound a sitting here, so it cannot be tightened either. */
  "CONSOLE_CEILING_DISABLED",
  /** No configured wallet has that id. Nothing was switched. */
  "CONSOLE_UNKNOWN_WALLET",
  /**
   * The transport died *after* a payment payload was signed, and the single
   * identical replay also failed. The authorization may or may not have settled.
   * **Re-read the canon. Do not re-run this command** — a fresh signature is a
   * second payment.
   */
  "CONSOLE_PAYMENT_INFLIGHT",
  /** DNS, connect or timeout. Nothing was signed and nothing settled. */
  "CONSOLE_TRANSPORT",

  // ── The agent ─────────────────────────────────────────────────────────────
  //
  // Every code below means the *chat* stopped something. None of them can be
  // returned by a tool call that reached the arena — a tool call that got that
  // far carries the arena's own answer, or one of the codes above, because it
  // went down `/api/act` like every button does.

  /** No chat provider is configured on this deploy. The pane renders disabled. */
  "CONSOLE_CHAT_UNAVAILABLE",
  /** That provider cannot run here — no key, or a subprocess asked for on serverless. */
  "CONSOLE_CHAT_PROVIDER_UNAVAILABLE",
  /** The model provider refused, timed out, or died. **Nothing reached the arena.** */
  "CONSOLE_CHAT_PROVIDER_ERROR",
  /**
   * Full autonomy needs an acknowledgement this server composed. The 428 names
   * the terms; the browser echoes them back unchanged, exactly as it does for a
   * payment. A mode the client could assert for itself is not a mode.
   */
  "CONSOLE_AUTONOMY_CONFIRM_REQUIRED",
  /** Full autonomy is not offerable here — no opt-in, no ceiling, or no wallet. */
  "CONSOLE_AUTONOMY_UNAVAILABLE",
  /** The agent reached for a signed or paid command with no live grant. Nothing was sent. */
  "CONSOLE_AUTONOMY_REQUIRED",
  /**
   * The amount `/api/act` computed exceeds the per-action cap. **Nothing was
   * signed** — the cap is checked between the 428 and the confirmed retry, not
   * after.
   */
  "CONSOLE_AUTONOMY_LIMIT",
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
 *
 * `CONSOLE_AUTONOMY_CONFIRM_REQUIRED` is 428 for the same reason
 * `CONSOLE_CONFIRM_REQUIRED` is: the request was well-formed and the missing
 * thing is a precondition the client can supply and retry with. The two are
 * separate codes because they name different things — one confirms an amount,
 * the other confirms that a machine may name amounts on your behalf.
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
  // 401 and not 403, and the distinction is the useful one: 403 says "you, no",
  // which is what CONSOLE_REMOTE_HOST means. 401 says "identify yourself and
  // try again", which is exactly true here — the browser is one login away.
  CONSOLE_UNAUTHENTICATED: 401,
  CONSOLE_AUTH_DISABLED: 409,
  CONSOLE_TOO_MANY_ATTEMPTS: 429,
  CONSOLE_INTERFACE_MISMATCH: 409,
  CONSOLE_COMMAND_DISABLED: 409,
  CONSOLE_CEILING_DISABLED: 409,
  CONSOLE_UNKNOWN_WALLET: 409,
  CONSOLE_PAYMENT_INFLIGHT: 502,
  CONSOLE_TRANSPORT: 502,
  CONSOLE_CHAT_UNAVAILABLE: 409,
  CONSOLE_CHAT_PROVIDER_UNAVAILABLE: 409,
  CONSOLE_CHAT_PROVIDER_ERROR: 502,
  CONSOLE_AUTONOMY_CONFIRM_REQUIRED: 428,
  CONSOLE_AUTONOMY_UNAVAILABLE: 409,
  CONSOLE_AUTONOMY_REQUIRED: 403,
  CONSOLE_AUTONOMY_LIMIT: 409,
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
  CONSOLE_UNAUTHENTICATED:
    "This console is password-protected and no session was presented. Log in again; nothing was read and nothing was signed.",
  CONSOLE_AUTH_DISABLED:
    "No password is configured on this deploy, so there is no door to open. Set CONSOLE_PASSWORD to put one there.",
  CONSOLE_TOO_MANY_ATTEMPTS:
    "Too many failed logins on this process. Wait, then try again — nothing is locked and the delay clears on its own.",
  CONSOLE_INTERFACE_MISMATCH:
    "The arena reports a different interface version. Reads still work; nothing will spend.",
  CONSOLE_COMMAND_DISABLED: "This command is not registered on this deploy.",
  CONSOLE_CEILING_DISABLED:
    "The ceiling is disabled on this deploy, so there is nothing to tighten. It cannot bound a sitting here.",
  CONSOLE_UNKNOWN_WALLET:
    "No wallet with that id is configured on this deploy. Nothing was switched, and the console still signs as it did.",
  CONSOLE_PAYMENT_INFLIGHT:
    "The connection died after a payment was signed. Re-read the canon before doing anything else — do not re-run this command.",
  CONSOLE_TRANSPORT: "The arena could not be reached. Nothing was signed.",
  CONSOLE_CHAT_UNAVAILABLE:
    "No model provider is configured on this deploy, so there is nothing for the agent to think with.",
  CONSOLE_CHAT_PROVIDER_UNAVAILABLE:
    "That provider cannot run here. The console renders the reason beside it rather than guessing at a substitute.",
  CONSOLE_CHAT_PROVIDER_ERROR:
    "The model provider refused or could not be reached. Nothing reached the arena and nothing was signed.",
  CONSOLE_AUTONOMY_CONFIRM_REQUIRED:
    "Full autonomy lets a machine sign and pay without asking. Confirm the terms this server named to proceed.",
  CONSOLE_AUTONOMY_UNAVAILABLE:
    "Full autonomy is not offerable on this deploy. Without a ceiling that can bound a sitting there is nothing to bound an agent.",
  CONSOLE_AUTONOMY_REQUIRED:
    "The agent reached for a command that signs or spends, and no grant is live. Nothing left the process.",
  CONSOLE_AUTONOMY_LIMIT:
    "The arena's price for that command is above the per-action cap for autonomous work. Nothing was signed.",
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
