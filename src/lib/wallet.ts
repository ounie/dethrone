import "server-only";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toBytes, type PrivateKeyAccount } from "viem";
import { isWalletKey, walletKeyVars } from "./assertions";
import type { WalletChoice } from "./operator";

/**
 * The keys. **The only module that has ever seen one**, and the other two that
 * need them (`sign.ts`, `pay.ts`) get an account from here rather than a string
 * from the environment.
 *
 * `import "server-only"` is the structural half of the guarantee: a client
 * component that imports this, directly or through six hops, is a *build*
 * error rather than a red test. `test/deps.test.ts` is the other half, and it
 * runs only when someone runs it — which is why both exist.
 *
 * Nothing here exports a raw key. There is no `getPrivateKey()` to misuse, and
 * no plural of one either: the two callers that need the literal strings for
 * redaction read `process.env` themselves, in the routes, where that intent is
 * visible — resolving *which* variables to read from `walletKeyVars`, the same
 * pure helper the boot check and this file use.
 *
 * ## Several wallets, one selection, and where it lives
 *
 * `DETHRONE_PRIVATE_KEY` is the primary; `DETHRONE_PRIVATE_KEY_<LABEL>` adds
 * more. One of them signs at a time, and **which one is server state, never a
 * request field** — the argument `chat/autonomy.ts` makes about the grant
 * applies here with more force: anything the browser can assert, anything that
 * can POST can assert, and the payer is not something a POST gets to choose.
 * `POST /api/wallet` moves the pointer; nothing else can.
 *
 * ## The account is captured before any await, and that is load-bearing
 *
 * `sign.ts:signedHeaders` and `pay.ts:payingFetch` both call `account()` once,
 * synchronously, before their first `await`, and close over the result. So a
 * `select()` landing mid-request cannot change who pays for a request already
 * in flight, and `/api/wallet` needs no lock. It is one refactor away from
 * being false — resolving the account lazily inside `pay.ts`'s wrapper would
 * break it silently — so it is written down here as well as there.
 *
 * ## Hot reload
 *
 * The selection is on `globalThis` and survives a module reload; the account
 * memo is not and does not. Editing `.env.local` restarts Next entirely, so the
 * selection resets to the primary. Editing code keeps it. Both are correct, and
 * the interaction is exactly what produces a puzzled "why did my wallet
 * change" — hence this paragraph.
 */

interface Entry {
  id: string;
  label: string;
  envVar: string;
  address: `0x${string}`;
  /** Never leaves this module. */
  account: PrivateKeyAccount;
}

let discovered: Entry[] | undefined;

/**
 * The selection, held where a hot reload cannot move it.
 *
 * Same shape as `spend.ts`'s session and `chat/autonomy.ts`'s grant, for the
 * same reason: a seatbelt — or in this case a payer — that changes every time
 * someone saves a file is not one. `null` means "nothing chosen yet", which
 * resolves to the first entry rather than to nothing.
 */
const GLOBAL_KEY = "__dethrone_console_wallet__";

interface Selection {
  id: string | null;
}

function selection(): Selection {
  const g = globalThis as unknown as Record<string, Selection | undefined>;
  return (g[GLOBAL_KEY] ??= { id: null });
}

function entries(): Entry[] {
  if (discovered !== undefined) return discovered;

  const list: Entry[] = [];
  for (const v of walletKeyVars(process.env)) {
    const raw = process.env[v.name]!.trim();
    if (!isWalletKey(raw)) {
      // Fail loudly at parse, not at settle. A malformed key that reaches the
      // facilitator surfaces as an opaque payment error three layers down,
      // after a request has already left the process. `assertions.ts` catches
      // this at boot; this is the backstop for a key set after boot — and it
      // names the variable, because with several configured "the key is bad"
      // is not an actionable sentence.
      throw new Error(
        `${v.name} is not a 32-byte hex key (expected 0x + exactly 64 hex characters)`,
      );
    }
    const account = privateKeyToAccount(raw as `0x${string}`);
    list.push({ id: v.id, label: v.label, envVar: v.name, address: account.address, account });
  }

  discovered = list;
  return discovered;
}

function current(): Entry | null {
  const list = entries();
  if (list.length === 0) return null;

  const id = selection().id;
  // Fall back to the first entry — the primary, when one exists — rather than
  // refusing. The selection outlives the memo (globalThis versus a module
  // `let`), so an id matching nothing means `.env.local` changed underneath it.
  // Falling back is the safe direction to fail in: the alternative is a console
  // that signs as nothing until someone thinks to click the dropdown.
  return list.find((e) => e.id === id) ?? list[0];
}

/**
 * The account that signs and pays right now, or `null` when no key is
 * configured.
 *
 * **`null` is a supported mode, not a failure.** Without a key the console
 * boots, every free read works, and every paid command renders disabled with
 * the reason. A fresh clone cannot cost anything on its first run, and the
 * public read-only deploy is this branch taken permanently.
 */
export function account(): PrivateKeyAccount | null {
  return current()?.account ?? null;
}

export function address(): `0x${string}` | null {
  return current()?.address ?? null;
}

/** Read-only mode is the correct default: no key, free reads still work. */
export function hasWallet(): boolean {
  return account() !== null;
}

/** Every configured wallet, in offer order. Addresses and labels; no accounts. */
export function wallets(): readonly WalletChoice[] {
  return entries().map(({ id, label, address, envVar }) => ({ id, label, address, envVar }));
}

/** Which of `wallets()` is signing, or null on a read-only deploy. */
export function selectedWalletId(): string | null {
  return current()?.id ?? null;
}

/**
 * Point the console at a different wallet for the rest of this sitting.
 *
 * Returns false when no configured wallet has that id, and changes nothing —
 * the caller renders a refusal. Matched on the **id** and never on an index or
 * a prefix: an index is a position in a list the client read one render ago,
 * and a prefix match turns a typo into a different wallet signing.
 */
export function select(id: string): boolean {
  if (!entries().some((e) => e.id === id)) return false;
  selection().id = id;
  return true;
}

/**
 * A short, stable, public tag for correlating log lines across a sitting.
 *
 * Derived from the **address**, not the key — an address is already public, so
 * this reveals nothing a `GET /api/seat` would not. It exists because a log
 * line that identifies which wallet acted is useful and a log line that
 * identifies it by a slice of its key is a leak. With several wallets
 * configured it has, for the first time, a question to answer: *which one?*
 */
export function keyFingerprint(): string | null {
  const addr = address();
  return addr ? keccak256(toBytes(addr)).slice(2, 10) : null;
}

/**
 * Test seam. Never called in production.
 *
 * Clears **both** the memo and the selection, and the `delete` is the
 * load-bearing half — the selection lives on `globalThis`, so without it one
 * case's `select()` leaks into the next and the failure reads as a bug in this
 * file rather than as one in test isolation. `__resetAutonomy` does the same
 * thing for the same reason.
 */
export function __resetWalletCache(): void {
  discovered = undefined;
  delete (globalThis as unknown as Record<string, Selection | undefined>)[GLOBAL_KEY];
}
