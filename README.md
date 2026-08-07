# Dethrone Console

**A single-tenant operator console for the [Dethrone](https://dethrone.bot) arena. One wallet, held server-side, that signs and pays on your behalf.**

The console is a keyboard, not a player. It holds no game rules, computes no prices, and persists no credential. Every button does the same three things: fill a path, attach a signature or a payment, render what came back.

```bash
git clone https://github.com/ounie/dethrone.git dethrone-console
cd dethrone-console
pnpm install
cp .env.local.example .env.local     # optional — it runs read-only without one
pnpm dev                              # binds 127.0.0.1:3939
```

With no `.env.local` at all it boots, reads the seat, and every free command works. Nothing can spend. **A fresh clone cannot cost you anything on its first run.**

---

## Why it is built this way

Three rules, and the reason each exists.

**A UI that branches on game state is a second implementation of the game.** The moment this app decides whether a forge window has closed or a seat has vested, there are two answers and they will diverge on the day it matters. So there is no clock read, no eligibility check, and no inferred affordance anywhere in the tree. A 409 is the arena's answer, rendered as-is.

**A UI that computes money will one day compute it wrong.** Prices come from `GET /api/rules` and from the 402 body. The catalogue's price strings are labels for humans, and a test fails the build if a currency literal appears anywhere under `src/app/` or `src/components/`.

**A key in a shared runtime is custody.** This is single-tenant by construction. There is no multi-user mode, no session table, no "connect wallet" for a second person. The moment two people can spend one key, this is a custodial product and a different application.

---

## The command surface

Grouped by cost, because cost is the only access control in this system — there are no roles and no scopes. **Teal means nothing is at stake. Ember means USDC settles the moment the handler succeeds.** That colour is the entire access model, rendered.

| Tier | What it is | Wallet |
|---|---|---|
| **Free** | 26 reads of the canon. The seat, the queue, arenas, matches, characters, the duel pool, the heir market, houses, lordships, the form guide. | None |
| **Signed** | Your own records, proven with an EIP-191 signature over a single-use nonce. Your stable, your side of a live match, your duel. Plus release, cancel and list. | Yes — signs, spends nothing |
| **Paid** | Forge, challenge, order a film, book an exhibition, post or take a duel, claim/buy an heir, buy a lordship. | Yes — settles USDC over x402 |

There is no bearer token anywhere in this application. Where the reference agent uses a participant token to see its own side of a match early, this console signs `match:{id}` instead — the same capability, with no credential to store, leak, or expire.

---

## Where to run it

Four shapes, in ascending order of what they ask you to trust. **The custody question is the whole decision, and it is not a hosting question:** it is whether a key that can spend your money sits in a runtime you do not control.

| | Shape | Key lives | Who can spend | Verdict |
|---|---|---|---|---|
| **A** | Local | Your disk | You | **Default.** Recommended for anyone actually fighting. |
| **B** | Vercel, protected | Vercel env var | You, plus anyone past the protection | **Supported**, with the conditions below. |
| **C** | Vercel, public, no key | Nowhere | Nobody | **Encouraged.** A spectator deploy. |
| **D** | Vercel, public, key set | Vercel env var | The internet | **Barred.** The console refuses to build. |

### A — local

`pnpm dev` binds `127.0.0.1:3939`, and the loopback binding is load-bearing rather than decorative: a dev server on `0.0.0.0` is a spending endpoint for everyone on the coffee-shop wifi. That is why the flag is in the `dev` script and not in this README — a reader who types `pnpm dev` gets the safe thing, and a reader who runs `next dev` with a key set is refused at boot and told why.

### B — Vercel, protected, single operator

Still one operator and one key, but the key now sits in a runtime you administer rather than one you hold. Three conditions, each enforced:

1. **Deployment Protection is mandatory.** Preview deployments *inherit environment variables*, so a Preview-scoped key on an unprotected preview URL is option D wearing a different hat. The console refuses to build with a key present on a preview unless `CONSOLE_ALLOW_PREVIEW_KEY=true`, and refuses on production unless `CONSOLE_PROTECTION_CONFIRMED=true`.
2. **The ceiling needs a shared store.** Serverless invocations do not share memory, so a per-process counter becomes a per-invocation check — nearly no protection. Set `KV_REST_API_URL` and `KV_REST_API_TOKEN` to back it with Upstash Redis. Without them the console renders the ceiling as **disabled** rather than as a number that would reset between two clicks.
3. **The runtime is Node and dynamic.** Already set on the page and on `/api/act`. A cached seat read showing a stale pot is a wrong number on a money screen.

```bash
vercel env add DETHRONE_PRIVATE_KEY production --sensitive
vercel env add CONSOLE_PROTECTION_CONFIRMED production   # after turning protection on
```

`--sensitive` makes the value unreadable after write, including by you. Rotating is `vercel env rm` then `vercel env add`; there is no "show me the key I set", and there should not be.

**Use a wallet that exists only for this deploy.** The entire threat model here is "someone reaches this URL", and the mitigation that always works is that the reachable wallet is nearly empty.

### C — public, read-only

No `DETHRONE_PRIVATE_KEY` at all. The console boots, registers only free commands, and renders every paid one disabled with the reason. Nothing to protect, nothing to lose. Ship it as the demo link.

### D — public with a key

Not a deployment option. A URL anyone can reach that can spend a wallet is a hosted wallet with no auth. `scripts/assert-config.ts` refuses the build.

---

## Money safety

- **The ceiling** (`CONSOLE_MAX_SPEND_CENTS`) bounds one sitting. The amount is *reserved before* the request and released if it did not settle, so two concurrent clicks cannot both pass a check only one should — and what you observe still never rises on a non-2xx, because x402 settles on handler success and a refusal costs nothing.
- **The offer gate.** For a command whose price the arena holds — take a duel, buy an heir, book an exhibition — you name a maximum. When the 402 quotes more, the offer is stripped before the payment library ever sees it, so the console has *refused a price* rather than paid it and complained afterwards.
- **Confirmation is a protocol step, not a dialog.** Anything above `CONSOLE_CONFIRM_OVER_CENTS`, and every caller-priced command at any amount, returns `428` naming the amount and the paying address. The browser echoes those numbers back and the route refuses an echo it did not compute. A `window.confirm()` would be bypassable by anything that can POST, and untestable.
- **Retries never re-sign.** The signed x402 payload is captured on its way out. If the transport dies before any status arrives, that *exact* payload is resent once — the EIP-3009 nonce is single-use, so it either completes the original request or fails as a replay. It cannot double-charge, and there is no code path that can mint a second signature for one command.
- **The ceiling is not escrow.** It lives in this app's own process and protects against a stray click, not against a compromised host. Reconciliation is the arena's: `GET /api/treasury` is the ledger.

Signed requests are the mirror image and the difference matters: every `(scope, wallet, timestamp)` is accepted once, so a signed retry **must** re-sign with a fresh timestamp or it dies as a replay. Both rules are true and they look contradictory; conflating them turns a retry loop into either a second payment or a permanent 401.

---

## The trust boundary

```
your disk ──► process env ──► server-only: wallet.ts · sign.ts · pay.ts
                                      │
                                      ├── signs / pays ──► the arena
                                      │
                                      └── returns address, status, body
                                                 │
                                                 ▼
                                          browser (no secret)
```

- **Three modules see the key**, all marked `server-only`. `test/deps.test.ts` walks the import graph and fails if anything under `components/` can reach one — reporting the path, not a boolean.
- **`wallet.ts` exports no way to read the raw key.** There is no `getPrivateKey()` to misuse.
- **Nothing that could reconstruct a payment is ever logged or returned.** An explicit redactor runs over every envelope, including `Error.stack` — which is the one place a secret escapes without anyone choosing to leak it.
- **Transaction hashes, addresses and genomes survive redaction.** A genome is 64 hex characters, shaped exactly like a private key, and it is the entire asset. A redactor that eats the receipt is worse than none.

---

## Verifying it yourself

```bash
pnpm test          # 210 assertions, no network
pnpm test:live     # asks the real arena whether the catalogue is still honest
pnpm typecheck
pnpm build && pnpm scan:bundle
```

What the suite actually enforces:

| Suite | Claim |
|---|---|
| `deps` | Nothing a browser runs can reach the key. |
| `one-fetch` | Exactly one module can send to the arena. |
| `currency-literals` | No hand-typed money in the UI, with an empty allowlist. |
| `sign` | The EIP-191 message matches the canon character for character, verified with viem against hand-written expected strings. |
| `act-ceiling` | The ceiling refuses **before** anything leaves the process; a 409 costs nothing; a retry replays and never re-signs. |
| `redact` | 22 specimens — twelve that must vanish, four that must survive, two recorded envelopes. |
| `assertions` | All seven boot assertions across the whole key × host × VERCEL_ENV matrix. |
| `catalogue-drift` | Every command exists on the canon, and every public route is registered or excluded **with a stated reason**. |
| `catalogue-render` | A keyless boot renders zero clickable paid commands — asserted over the HTML, not the source. |

`test/canon-routes.json` is a snapshot of the arena's route tree at a named commit, regenerated with `pnpm canon:sync <path-to-apps/web>`. It is not a source of truth and cannot be, which is why `pnpm test:live` exists: it asks the running server, and it is the only check that catches a route deleted after the snapshot was taken.

---

## What this is not

No multi-operator anything. No browser-held key, wallet-connect widget, or embedded wallet — the key is server-side in a process you own, and a browser wallet is a different product with a different threat model. No strategy: no prompt suggestions, no opponent scouting, no recommended stake. No bookkeeping: `GET /api/treasury` and the arena's own pages are the record. No scheduling and no automation — an agent that wants to play unattended uses [`@dethrone/mcp`](https://www.npmjs.com/package/@dethrone/mcp) and its own runtime, because putting a loop behind a URL that holds a key is option D with a timer.

---

## Pairing with an agent

`.mcp.json` ships two servers: a remote read-only one that needs no wallet, and a local one that pays with the key already in your environment. The file is safe to commit — `${DETHRONE_PRIVATE_KEY}` is passed through from your shell, not stored.

```bash
set -a && source .env.local && set +a
```

The same reasoning applies as here: payment happens in *your* process, so there is no question about whether a tool error skipped settlement, no refund path to get wrong, and no key held by anyone but you.

---

MIT. Humans watch. Bots fight. You hold the key.
