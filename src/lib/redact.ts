/**
 * The redactor.
 *
 * Pure, and it imports nothing. It never reads `process.env`, so it cannot leak
 * a secret it was not handed, and it can be tested exhaustively with a fixture
 * key that was never real.
 *
 * ## Why this exists
 *
 * Logs are the one place a secret escapes without anyone choosing to leak it. A
 * library echoes its argument into an error message, the error is logged with
 * its stack, and a private key is now in a file someone will later paste into a
 * bug report. So every value that leaves this process — the `/api/act` envelope
 * and every log line — goes through here first.
 *
 * ## What must survive
 *
 * A redactor that eats the receipt is worse than none. A transaction hash is
 * the operator's only link to the chain; an address is public; a genome is
 * 64 hex characters that look exactly like a private key and is the entire
 * asset. All three are asserted to survive in `test/redact.test.ts`, and that
 * half of the corpus is the half that catches an over-eager pattern.
 *
 * ## The agent gave this module a second job
 *
 * It used to run once, on the way to the browser, guarding one secret. It now
 * runs twice: `/api/act` redacts its envelope as before, and the chat executor
 * redacts that envelope *again* before it becomes a tool result — because a
 * tool result is sent to a third-party model provider, which is an egress
 * `/api/act` was never written to think about, and because the provider keys
 * are secrets `/api/act` has never heard of. Same function, different secrets
 * list, different destination.
 */

const REDACTED = "[redacted]";

/**
 * Keys whose *value* is a credential regardless of what it looks like.
 * The key is kept so the shape of the response stays legible.
 */
const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /^payment-signature$/i,
  /^x-payment$/i,
  /^payment$/i,
  /signature/i,
  /private[_-]?key/i,
  /participant[_-]?token/i,
  /\bsecret\b/i,
  /mnemonic|seed[_-]?phrase/i,
  /^x-admin-token$/i,
  /^cookie$/i,
  // The agent's credentials. `x-api-key` is Anthropic's own header name, which
  // is the one that matters: an SDK error carrying its request headers is
  // exactly the accident this module exists for. `apiKey` catches the config
  // object a provider adapter throws with, in whichever casing it chose.
  /api[_-]?key/i,
  /access[_-]?token/i,
];

/**
 * `authorization` is two different things wearing one word, and blanking both
 * costs more than it buys.
 *
 * As a **string** it is an HTTP header — `Bearer …` — and it is a credential.
 * As an **object** it is the EIP-3009 authorization: `from`, `to`, `value`,
 * `nonce`. That object cannot reconstruct a payment on its own; the thing that
 * can is its sibling `signature`, which the pattern above already removes, and
 * the encoded payload, which the base64 sniff already removes.
 *
 * So a string is dropped and an object is walked. The difference is a money
 * screen that can still show the operator who paid whom how much.
 */
const AUTHORIZATION_KEY = /^authorization$/i;

/**
 * An EIP-191 / EIP-3009 signature is 65 bytes — `0x` plus 130 hex characters.
 *
 * The bound is 130 and not 64, and the difference is the whole design: a
 * private key and a genome are both `0x` + 64, and one of them is public. A
 * pattern that caught 64 would redact the asset. Exact-secret substitution
 * (below) handles the key, because the process knows its own key and does not
 * have to guess.
 */
const SIGNATURE_RE = /0x[0-9a-fA-F]{130,}/g;

/** A base64 x402 payload. Recognised by decoding, not by length alone. */
function looksLikeX402Payload(value: string): boolean {
  if (value.length < 120 || /[^A-Za-z0-9+/=_-]/.test(value)) return false;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    return /"x402Version"|"authorization"|"payload"/.test(decoded);
  } catch {
    return false;
  }
}

function scrubString(input: string, secrets: readonly string[]): string {
  let out = input;
  // Exact secrets first: the process knows its own key, so this needs no
  // heuristic and cannot produce a false positive.
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join(REDACTED);
  }
  out = out.replace(SIGNATURE_RE, "[redacted:signature]");
  if (looksLikeX402Payload(out)) return "[redacted:payment]";
  return out;
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((re) => re.test(key));
}

/**
 * Deep-clone `value`, removing anything that could reconstruct a payment.
 *
 * `secrets` are exact strings to erase wherever they appear, including inside
 * an `Error.message` or `Error.stack`.
 */
export function redact(value: unknown, secrets: readonly string[] = []): unknown {
  return walk(value, secrets, new WeakSet(), 0);
}

function walk(
  value: unknown,
  secrets: readonly string[],
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (depth > 24) return "[redacted:depth]";

  if (typeof value === "string") return scrubString(value, secrets);
  if (value === null || typeof value !== "object") return value;

  if (seen.has(value)) return "[circular]";
  seen.add(value);

  // Errors are the highest-risk shape in the tree: a library that echoed its
  // argument puts the key in `.message`, and the stack carries it again.
  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message, secrets),
      ...(value.stack ? { stack: scrubString(value.stack, secrets) } : {}),
    };
  }

  if (Array.isArray(value)) {
    return value.map((v) => walk(v, secrets, seen, depth + 1));
  }

  if (value instanceof Headers) {
    return walk(Object.fromEntries(value.entries()), secrets, seen, depth + 1);
  }

  if (value instanceof Map) {
    return walk(Object.fromEntries(value.entries()), secrets, seen, depth + 1);
  }

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(key)) {
      out[key] = REDACTED;
    } else if (AUTHORIZATION_KEY.test(key) && typeof v === "string") {
      out[key] = REDACTED;
    } else {
      out[key] = walk(v, secrets, seen, depth + 1);
    }
  }
  return out;
}
