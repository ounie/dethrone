# Dethrone Console

**A single-tenant operator console for the [Dethrone](https://dethrone.bot) arena. One wallet, held server-side, that signs and pays on your behalf.**

The console is a keyboard, not a player. It holds no game rules, computes no prices, and persists no credential. Every button does the same three things: fill a path, attach a signature or a payment, render what came back.

There is now a second keyboard — an [agent](#the-agent) you can talk to, on your Claude subscription or an LLM provider key. It has no tools but the catalogue's, no route to the arena but the one every button uses, and by default no authority to do anything that signs or spends. See [The agent](#the-agent).

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
| **Free** | 27 reads of the canon, including a fighter's legal action menu. The seat, the queue, arenas, matches, characters, the duel pool, the heir market, houses, lordships, the form guide. | None |
| **Signed** | Your own records, proven with an EIP-191 signature over a single-use nonce. Your stable, your side of a live match, your duel. Plus release, cancel, list — and **submitting your five actions** inside a selection window. | Yes — signs, spends nothing |
| **Paid** | Forge, challenge, order a film, book an exhibition, post or take a duel, claim/buy an heir, buy a lordship. | Yes — settles USDC over x402 |

**Sequences get a picker, not a text box.** A submission is five integers, but they are indices into a menu that depends on the fighter's genome — so the field loads that menu through the same `/api/act` path every other button uses, and you choose in exchange order. It shows the selection window as the arena last reported it, with the time of the read beside it, and **no countdown**: a ticking clock here would be the window rule reimplemented in a browser, and the day the two disagree the one on your screen is the wrong one.

It also does not check that you picked five, or that an index is in range. Those are the canon's rules; the console forwards what you chose and renders the refusal.

There is no bearer token anywhere in this application. Where the reference agent uses a participant token to see its own side of a match early, this console signs `match:{id}` instead — the same capability, with no credential to store, leak, or expire.

**The agent's tools are this table, generated.** Not a parallel list that happens to match: one tool per command, derived from the same catalogue, so the tier a command sits in is the tier its tool sits in and neither can drift from the other. What the colours mean to you, they mean to it.

---

## Where to run it

Four shapes, in ascending order of what they ask you to trust. **The custody question is the whole decision, and it is not a hosting question:** it is whether a key that can spend your money sits in a runtime you do not control.

| | Shape | Key lives | Who can spend | Verdict |
|---|---|---|---|---|
| **A** | Local | Your disk | You | **Default.** Recommended for anyone actually fighting. |
| **B** | Vercel, protected | Vercel env var | You, plus anyone past the protection | **Supported**, with the conditions below. |
| **C** | Vercel, public, no key | Nowhere | Nobody | **Encouraged.** A spectator deploy. |
| **D** | Vercel, public, key set | Vercel env var | The internet | **Barred.** The console refuses to build. |

**Two things about the agent follow from this table rather than being decided separately.** Claude on your own subscription needs a machine to spawn a process on and credentials on disk to inherit, so it exists in **A** and nowhere else; the other three providers work in any shape that has their key. And **full autonomy is A only** — a boot assertion refuses to start when it is set alongside a key on serverless, or alongside `CONSOLE_ALLOW_REMOTE`, because an agent that can spend behind a URL other people can reach is shape D with a language model where the timer would be.

### A — local

`pnpm dev` binds `127.0.0.1:3939`, and the loopback binding is load-bearing rather than decorative: a dev server on `0.0.0.0` is a spending endpoint for everyone on the coffee-shop wifi. That is why the flag lives in the `dev` script and not in this README — a reader who types `pnpm dev` gets the safe thing without having to know why.

**The bind is enforced per request, not at boot**, and the difference is worth knowing. `instrumentation.ts` runs in a child process whose `argv` does not carry the `--hostname` you passed, so a boot-time check usually cannot see the bind at all; treating that silence as "bound to everything" would refuse to start on the documented, safe path. So when the bind is unknown the console warns, and `/api/act` refuses paid commands whose `Host` is not loopback — reading the address a caller really used, which also catches a tunnel, a reverse proxy, and a `--hostname` overridden after boot. The `dev` script exports `HOST=127.0.0.1` alongside the flag so the boot check can confirm it too.

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

- **The ceiling** (`CONSOLE_MAX_SPEND_CENTS`) bounds one sitting — one process lifetime. It can be **tightened from the UI and never loosened**: a seatbelt you can widen at the moment it stops you is not a seatbelt, and the failure mode is one click long. Raising it means editing `.env.local` and restarting, which is an act you have to mean. Note that lowering the cap below `CONSOLE_CONFIRM_OVER_CENTS` in env is a hard boot failure (`CONSOLE_CAP_BELOW_CONFIRM`) — lower both together. The amount is *reserved before* the request and released if it did not settle, so two concurrent clicks cannot both pass a check only one should — and what you observe still never rises on a non-2xx, because x402 settles on handler success and a refusal costs nothing.
- **The offer gate.** For a command whose price the arena holds — take a duel, buy an heir, book an exhibition — you name a maximum. When the 402 quotes more, the offer is stripped before the payment library ever sees it, so the console has *refused a price* rather than paid it and complained afterwards.
- **Confirmation is a protocol step, not a dialog.** Anything above `CONSOLE_CONFIRM_OVER_CENTS`, and every caller-priced command at any amount, returns `428` naming the amount and the paying address. The browser echoes those numbers back and the route refuses an echo it did not compute. A `window.confirm()` would be bypassable by anything that can POST, and untestable.
- **The threshold tightens and never loosens.** A caller may ask `/api/act` to demand a confirmation it would otherwise skip — the agent does, since the 428 is the only place a price is revealed before it settles, and its per-action cap is far below a human's threshold. The route takes the minimum, so a request can make it *ask* a question and can never make it stop asking one. This exists because the cap had a hole without it: a paid command cheaper than `CONSOLE_CONFIRM_OVER_CENTS` used to execute with the agent never seeing an amount, which made the cap not a cap for exactly the commands most likely to run. Every test passed while that was true; running it found it in a minute.
- **Retries never re-sign.** The signed x402 payload is captured on its way out. If the transport dies before any status arrives, that *exact* payload is resent once — the EIP-3009 nonce is single-use, so it either completes the original request or fails as a replay. It cannot double-charge, and there is no code path that can mint a second signature for one command.
- **The ceiling is not escrow.** It lives in this app's own process and protects against a stray click, not against a compromised host. Reconciliation is the arena's: `GET /api/treasury` is the ledger.

Signed requests are the mirror image and the difference matters: every `(scope, wallet, timestamp)` is accepted once, so a signed retry **must** re-sign with a fresh timestamp or it dies as a replay. Both rules are true and they look contradictory; conflating them turns a retry loop into either a second payment or a permanent 401.

---

## The agent

A chat pane, sitting above the command form because it is a second keyboard onto the same Run button rather than a thing you read. It has no tools of its own: every tool it can call is a command in the catalogue, generated from it, so a command added tomorrow becomes a tool with no edit and a tool that drifts from the catalogue is a failing test.

### Four backends, one of which asks for no key

| | What pays | Where it runs |
|---|---|---|
| **Claude, on your Max or Pro plan** | your subscription | **Local only.** No API key exists. |
| **OpenRouter** | `OPENROUTER_API_KEY` | anywhere |
| **Anthropic API** | `ANTHROPIC_API_KEY` | anywhere |
| **Any OpenAI-compatible endpoint** | your own base URL and key | anywhere |

The first is worth explaining because it is the one people ask for and the one with a catch. A Claude subscription cannot be used over the Messages API — there is no key to issue. What can use it is [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), which spawns a local `claude` process that resolves the credentials you already have from Claude Code or `ant auth login`. So your subscription pays and this repo never holds a credential for it — and it needs a machine to spawn a process on and credentials on disk to inherit, neither of which a Vercel invocation has. There it renders unavailable and says so, rather than failing at your first message.

That subprocess gets the console's tools and nothing else. Bash, Read, Write, Edit, Glob, Grep, WebSearch and WebFetch are all off, and a permission callback allows the arena's commands **by name** — so a tool a future SDK version adds is denied by default rather than inherited. It runs on the machine holding your wallet; a coding agent's default toolset there is a much larger surface than the arena.

Set none of these and the pane renders disabled with the reason, exactly like a paid command on a keyless boot.

### What it may do

**By default: the free reads, and nothing else.** Ask it who holds the seat and it reads the seat. Ask it to forge and it reads the rules, derives your fighter — both free — and then hands you a **proposal**: a card naming the command and the price, whose button loads the real form into the pane below, pre-filled. You see the arguments as editable fields and the real preview of the body. You press the real Run button, and hit the same 428 confirmation any manual command hits.

That costs one extra click, and it is the correct price for a machine spending your money. It also keeps something true that is easy to lose: there is exactly one ember button on this screen, and it is the one you press yourself.

**Full autonomy** is the other mode, and it is off until you do three separate things. Set `CONSOLE_ALLOW_FULL_AUTONOMY=true`. Then turn it on in the UI, which is a **428 naming terms the server composed** — the payer, the per-action cap, the sitting ceiling — that your browser echoes back unchanged. Tighten the ceiling while that dialog is open and the echo no longer matches, so you read the new terms instead of confirming stale ones.

What it buys, said plainly: this is **not** authentication and must not be read as such. On a single-tenant console on loopback with no login, anything that can POST once can POST twice. It buys what the payment 428 buys — the mode cannot be set by accident, by a stray request, or by a tool call the model itself emits, and the terms are the server's rather than the caller's. The things that actually bound an agent are unchanged in both modes: the loopback check on every paid command, the ceiling's reserve-and-release, the offer gate, and a wallet holding only what you meant to risk.

Even under full autonomy: **the amount is never the agent's.** A paid command is sent unconfirmed, the route answers 428 with the figure it computed, that figure is checked against the per-action cap, and only then is it echoed back verbatim. There is no arithmetic on that path by design, so "the model decided to spend more" is not a reachable state. `release` stays yours alone in either mode — it destroys a claim and moves no money, so no cap can bound it, and a cap that cannot bound a thing is not permission for it.

Turning autonomy off is one click with no dialog. That asymmetry is the ceiling's one-way-tightening doctrine inverted: restraint should always be cheaper than permission.

### The new egress, stated once and plainly

**Your message, the whole transcript, and every tool result — arena response bodies, your address, your stable, your fighters' genomes — go to whichever provider you picked.** This console did not send anything to a third party before, and now it does. The wallet key does not go with them, and a tool result is redacted a second time on its way out with the provider keys as secrets `/api/act` has never heard of. But everything the agent reads on your behalf leaves this machine.

---

## The trust boundary

```
your disk ──► process env ──► server-only: wallet.ts · sign.ts · pay.ts
                                      │
                                      ├── signs / pays ──► the arena
                                      │                        ▲
                                      └── returns address,     │ every tool call,
                                          status, body         │ through /api/act
                                                 │             │
                                                 ▼             │
                                          browser (no secret)  │
                                                 │             │
                                                 ▼             │
                                          /api/chat ───────────┘
                                                 │
                                                 └── prompt · transcript · tool results
                                                              │
                                                              ▼
                                                     your model provider
                                                     (no wallet key, ever)
```

- **Three modules see the key**, all marked `server-only`. `test/deps.test.ts` walks the import graph and fails if anything under `components/` can reach one — reporting the path, not a boolean.
- **`wallet.ts` exports no way to read the raw key.** There is no `getPrivateKey()` to misuse.
- **Nothing that could reconstruct a payment is ever logged or returned.** An explicit redactor runs over every envelope, including `Error.stack` — which is the one place a secret escapes without anyone choosing to leak it.
- **Transaction hashes, addresses and genomes survive redaction.** A genome is 64 hex characters, shaped exactly like a private key, and it is the entire asset. A redactor that eats the receipt is worse than none.
- **The agent's keys are a second shape, and the checks now know it.** Until the chat pane the only credential here was `0x` and 64 hex, so a 0x-shaped test was a complete test. An `sk-ant-…` key matched nothing. The boot assertion, the redactor and the bundle scan each learned the new shape — and each also learned to fail on a variable *named* like a credential, because the provider after next will have a shape nobody here has seen.
- **The agent cannot reach the arena except through `/api/act`.** Not asserted in prose: `test/one-fetch.test.ts` blanks the act route out of the import graph and checks that the arena becomes unreachable from the chat route. Two doors are accounted for — the guarded execution path, and the free price cache every screen reads — and the test fails on a third.

---

## Verifying it yourself

```bash
pnpm test          # 533 assertions, no network — no arena, no language model
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
| `redact` | 27 specimens — seventeen that must vanish, eight that must survive, two recorded envelopes. |
| `assertions` | All ten boot assertions across the whole key × host × VERCEL_ENV matrix. |
| `catalogue-drift` | Every command exists on the canon, and every public route is registered or excluded **with a stated reason**. |
| `catalogue-render` | A keyless boot renders zero clickable paid commands — asserted over the HTML, not the source. |
| `chat-tools` | The agent's tool surface *is* the catalogue: one tool per enabled command, over every command, with no orphan either way. |
| `chat-execute` | In reads mode **nothing** that signs or spends reaches the arena — asserted for every non-free command, by the network stub never being called. |
| `chat-route` | A request body cannot grant itself authority; the amount always comes from `/api/act`; a forwarded Host is not a forged one. |
| `autonomy` | Every way the grant fails closed: an unminted nonce, a replayed one, terms that changed underneath the operator. |

`test/canon-routes.json` is a snapshot of the arena's route tree at a named commit, regenerated with `pnpm canon:sync <path-to-apps/web>`. It is not a source of truth and cannot be, which is why `pnpm test:live` exists: it asks the running server, and it is the only check that catches a route deleted after the snapshot was taken.

---

## What this is not

No multi-operator anything. No browser-held key, wallet-connect widget, or embedded wallet — the key is server-side in a process you own, and a browser wallet is a different product with a different threat model. No bookkeeping: `GET /api/treasury` and the arena's own pages are the record. No token accounting either: there is no model pricing and no per-turn cost anywhere on this screen, because a second currency on a money screen is one currency too many.

**No scheduling.** Nothing here runs unless a person opens a turn. There is no cron, no queue, no background loop, and closing the tab ends it.

This paragraph used to say "no automation" as well, and that half is no longer true — the console hosts an agent now, so here is the line as it actually stands. The agent is bounded by the same single execution path every button uses. By default it runs the free reads and nothing else, and anything that would sign or spend comes back as a **proposal** you load into the command pane and run yourself, through the same confirmation a manual command gets. Full autonomy exists, is off by default, needs an env opt-in *and* an acknowledgement the server composed, is refused outright on any deploy where the ceiling cannot bind or the host is not loopback, is capped per action as well as per sitting, is revocable in one click, and dies with the process. An agent that wants to play *unattended* still uses [`@dethrone/mcp`](https://www.npmjs.com/package/@dethrone/mcp) and its own runtime, because putting a loop behind a URL that holds a key is still option D with a timer.

Still no strategy, and the distinction is worth keeping: the agent reads the canon and tells you what it says. It has no opponent model, no recommended stake, and no opinion this console taught it.

---

## Pairing with an agent of your own

Distinct from [the agent in the pane](#the-agent), and worth keeping distinct. That one runs inside this console and is bounded by it; this is your own runtime talking to the arena directly, bounded by nothing here.

`.mcp.json` ships two servers: a remote read-only one that needs no wallet, and a local one that pays with the key already in your environment. The file is safe to commit — `${DETHRONE_PRIVATE_KEY}` is passed through from your shell, not stored.

```bash
set -a && source .env.local && set +a
```

The same reasoning applies as here: payment happens in *your* process, so there is no question about whether a tool error skipped settlement, no refund path to get wrong, and no key held by anyone but you.

**What you give up by going this way is the ceiling.** `@dethrone/mcp` has no spend cap, no per-action cap and no confirmation step — it pays whatever the 402 asks. That is the right trade for an agent that plays unattended, and it is exactly why the console's own agent does not use it: a tool call that paid outside this process would be a payment the ceiling never saw. Pick the one that matches how closely you are watching.

---

MIT. Humans watch. Bots fight. You hold the key.
