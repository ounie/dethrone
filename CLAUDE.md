# Dethrone Console — agent guide

A single-tenant operator console for the Dethrone arena. One wallet, held
server-side, that signs and pays. **The console is a keyboard, not a player:**
it holds no game rules, computes no prices, and persists no credential.

`README.md` is written for the person running it. This file is for whoever is
editing it, and it is mostly a list of the ways this repo will refuse your
change — deliberately, and usually correctly.

---

## The three rules everything else follows from

**A UI that branches on game state is a second implementation of the game.** No
clock read, no eligibility check, no inferred affordance. A 409 is the arena's
answer, rendered as-is. If you find yourself writing `if (windowClosed)`, stop.

**A UI that computes money will one day compute it wrong.** Prices come from
`GET /api/rules` and from the 402 body. `src/lib/commands.ts` is the **only**
file under `src/` allowed to contain a currency literal.

**A key in a shared runtime is custody.** Single-tenant by construction. No
multi-user mode, no session table, no second person who can spend.

---

## The five tests that will fail your change

Read this section before writing code, not after. Each of these exists because
the property it guards is invisible until it is violated.

### `one-fetch` — exactly one door to the canon

It enforces **one destination, not one call site.** Four components now `fetch`
`"/api/act"` — `console.tsx`, `action-picker.tsx`, `fighters-pane.tsx` and the
approve button's path through `console.tsx` — and that is fine, because every
one of them is asking through the single guarded route. A second *address* is
what fails.

Three separate traps:

- **A new same-origin route** must be added to `OWN_ROUTES` in
  `test/one-fetch.test.ts` with a `why` string over 30 characters, and a handler
  must exist at exactly `src/app/<path>/route.ts`.
- **Client `fetch` must take a string literal.** `fetch(url)` with a variable
  reports as `<dynamic>` and fails. So does a template URL.
- **Any outbound `fetch` that is not an own-route** needs a named entry in
  `OUTBOUND_EXEMPT` with a stated reason, and the entry must not read
  `process.env.DETHRONE_BASE_URL`.

There is also an **import-graph assertion**: blank `/api/act` and `lib/rules.ts`
out of the graph, and `lib/arena.ts` must be unreachable from `/api/chat`. Two
doors are accounted for — the guarded execution path and the free price cache —
and a third fails the test.

⚠️ **This test cannot see inside `node_modules`.** Two chat providers reach the
network through an SDK and one spawns a subprocess; all of it is invisible to
the AST scan. `test/chat-route.test.ts` compensates by pinning that each SDK is
reachable from exactly one file. Do not read `OUTBOUND_EXEMPT` as the complete
inventory of outbound destinations.

### `currency-literals` — no hand-typed money, empty allowlist

Four regexes, run **line by line over raw source including comments and
strings**, across `src/app/**` and `src/components/**`. The ones that catch
people:

- `/\$\s*\d/` — fires on a comment saying "costs $0.10", and on a system prompt
  string. `src/app/api/chat/route.ts` is scanned, which is why
  `lib/chat/prompt.ts` lives under `src/lib/`.
- `/\b\w*(cents|usdc|price|fee)\w*\s*[:=]\s*\d+/i` — fires on `maxCents: 0`, on
  `priceCents = 0`, on any zero-default with a money-shaped name.

Put the number in `src/lib/commands.ts` or somewhere under `src/lib/`. Never add
an allowlist entry; the file explains why at length.

### `deps` — nothing a browser runs can reach the key

Every file under `src/components/` is auto-enrolled. None may have a **value**
import path to `lib/wallet.ts`, `lib/pay.ts` or `lib/sign.ts`.

⚠️ **The type-only escape hatch is declaration-level only.** `import type { X }
from "…"` is erased. `import { type X, somethingElse }` is **not** — the inline
marker still counts as a runtime edge and will fail. This is why `lib/agent.ts`
and `lib/capability.ts` exist: client-safe type modules holding no values.

Any module that sees a key or the network must start with the exact literal
`import "server-only";` at column 0, and be listed in `mustBeServerOnly`.

### `assertions` — the `toEqual([])` cases are load-bearing

A dozen cases assert *exactly zero* findings on happy-path fixtures. **Any new
unconditional `fail` or `warn` breaks all of them at once**, and the tempting
fix is to weaken the assertions rather than the finding.

Gate every new finding on an env var no existing fixture sets. Add cases; never
edit the existing ones.

### `catalogue-drift` / `catalogue-render`

- `EXCLUDED_ROUTES` in `commands.ts` is about **the arena's** routes, not this
  console's. Adding `/api/chat` there fails the test — an exclusion for a path
  absent from `canon-routes.json` is an error.
- `catalogue-render` counts `data-enabled="true"` in `Rail`'s HTML against the
  free-command count. Anything you add inside `rail.tsx` emitting those
  attributes breaks it. Agent affordances stay in the chat pane.

---

## The one execution path

`POST /api/act` is the only thing that talks to the arena. It contains **no
`switch (id)`** — it is driven entirely by the catalogue, and
`test/catalogue-drift.test.ts` asserts the properties a switch would have
protected.

Order is load-bearing; every refusal happens before anything leaves the process:

```
registration gates → wallet → interface pin → host check → fill path/body
→ cost → confirmation → ceiling reserve → signature → request
→ (one replay on transport death, never re-signed) → release on non-2xx → redact
```

**`confirmOverCents` may be supplied by a caller and only ever tightens**
(`Math.min`, never assignment). The agent passes `0` so every paid command is
priced before it settles. The worst a hostile value can do is make the route ask
a question. This exists because the agent's per-action cap had a hole without it
— see the git log.

---

## The agent

A chat pane that is a **second keyboard on the same instrument**.

| Module | Job |
|---|---|
| `lib/chat/tools.ts` | Tools **derived** from `COMMANDS`. Never hand-written. |
| `lib/chat/act-bridge.ts` | Imports `/api/act`'s `POST`; does not fetch it. |
| `lib/chat/execute.ts` | The gate: tier, grant, one 428 echo, second redaction. |
| `lib/chat/autonomy.ts` | The server-held grant. Memory only, by design. |
| `lib/chat/providers/*` | Four backends behind one adapter shape. |

Four things that are not negotiable without a very good argument:

**Tools are derived, not listed.** Adding a command to `commands.ts` adds a tool
with no edit. `test/chat-tools.test.ts` asserts the bijection over every command.

**The bridge imports the handler rather than fetching it.** A fetch would need
an absolute URL (failing `one-fetch`) and would let a future edit skip a gate.
It copies `host` and `x-forwarded-host` **verbatim** — forging loopback there
would turn a reachable deploy's chat pane into a paid-command path that a direct
POST would have refused.

**The mode is re-read on every tool call**, never cached per turn and never a
request field. A turn runs up to 8 rounds; a revoke that waits for the turn to
end is not a revoke.

**The 428 echo happens exactly once.** It is one keystroke from
`while (status === 428)`, which is a double-spend generator.

### Claude Max specifics

- The subprocess gets an environment with `ANTHROPIC_API_KEY` and
  `ANTHROPIC_AUTH_TOKEN` **stripped**. Without that, a console with an API key
  set would bill the API under a label saying "subscription". Measured:
  `apiKeySource` came back as `ANTHROPIC_API_KEY` with the var set, `none`
  without.
- `allowedTools` is **empty** and `canUseTool` is the gate. A bare name in
  `allowedTools` auto-approves *before* the callback runs
  (`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`), which made the callback dead code.
- The console runs **no auth flow**, on purpose — it borrows a session from
  `claude login`, so the credential stays in the OS keychain. It detects a
  missing binary via PATH and turns `authentication_failed` into a sentence
  naming the command to run. It deliberately does **not** read the keychain.

---

## The Fighters panel

Roster → portrait → the sixteen actions → a plan → a window. Four things about
it are load-bearing:

**It cannot spend.** Its three arm buttons call `loadCommand`, which selects a
catalogue command and fills its fields. `test/fighters-pane.test.ts` reads the
AST and fails if any `act(...)` call names a `tier: "paid"` command — that is
the mechanism, not the comment.

**Five is read, never typed.** `GET /api/rules` publishes
`actions.sequenceLength`, threaded through `lib/rules.ts` → `page.tsx` →
`Console` → the pane → `SequenceBuilder`'s `capacity`. **Null means no cap at
all**, not a fallback of five: a guessed length is a game rule in a browser, and
it would refuse a legal plan the day the rule versions.

**The plan is memory-only, and combos are not the same thing.** A plan dies with
the tab, deliberately — a persisted one is a standing sequence, which the arena
has no concept of on purpose. Saved combos DO persist, in `localStorage`, and
are a different object: they store stable **action ids**, not indices, because
indices are positions in one fighter's menu and replaying them on another
fighter submits five legal integers naming five different moves. `lib/combos.ts`
and `test/combos.test.ts` carry that argument.

**Approving a proposal is not a second execution path.** `chat-proposal.tsx`'s
approve button calls `runCommand`, which is `send` with the proposal's own
arguments — every gate on `/api/act` runs in the same order, and a paid command
still earns its 428 and the confirmation dialog. `send` takes its args
explicitly for exactly this reason: closing over the form's `args` would make
"Approve" issue whatever happened to be typed there.

## Layout

`.console` is a four-row grid: rail (sticky, spans all rows), fighters (spanning
both content columns, above everything), a cause-things column (chat → command →
log), and a see-things column (response → seat).

⚠️ **The rail is `position: sticky`, so nothing may span into column one.** A
sticky element stays pinned after the page scrolls past its grid area; an area
crossing both columns ends up underneath it. That bug put the catalogue on top
of the seat readout at the 1500px breakpoint. All three of `.console`'s
`grid-template-areas` blocks — base, ≤1500px, ≤900px — must be edited together.
(A fourth occurrence in the file is the masthead's `none` reset; leave it.)

### Colour is the access model, rendered

From `globals.css`'s first paragraph, and it is enforced socially rather than by
a test, so it needs saying here:

> **Ember fill + rim glow = one button, the one that settles an amount now.
> Ember hairline or tint = a caution frame, and nothing else.**

Teal marks the lane where nothing is at stake. Gold is a material — hairlines,
frames, a voice. Amber (`--awaiting`) means a guard is off. **No token counts and
no model pricing anywhere**: that number is money, it would want ember, and it
would be a second currency on a screen whose whole argument rests on there being
one.

The five `--type-*` hues are the one place five colours are spent at once, and
they are a taxonomy rather than a signal. Two are deliberately not the obvious
token: `strike` is salmon and never `--ember-*`, because ember is the money
colour and a strike badge would put it on sixteen menu rows; `bind` is a duller,
lighter gold than `--gold-400`, which is the frame material. They are safe as
colour only because every tag also prints its own name.

---

## Working here

```bash
pnpm dev          # binds 127.0.0.1:3939 — the loopback bind is load-bearing
pnpm test         # ~533 assertions, no network, no arena, no model
pnpm typecheck
pnpm lint
pnpm build && pnpm scan:bundle
pnpm test:live    # asks the real arena whether the catalogue is still honest
```

- **Tests flake under load.** Two route tests have a 5s default timeout and will
  time out with a browser and dev servers running. Re-run them alone before
  believing a failure.
- **Next 16 refuses a second dev server** in the same directory. Check for a
  stale lock before assuming your port is the problem.
- **Only `pnpm build` runs the boot assertions**; `scan:bundle` is separate and
  manual.
- `test/canon-routes.json` is a snapshot, regenerated with
  `pnpm canon:sync <path-to-apps/web>`. It is not a source of truth, which is
  what `pnpm test:live` is for.

## Prose style

Comments here explain **why**, not what, and they are unusually long on purpose:
almost every one records a decision that has a plausible-looking alternative.
When you fix something subtle, say what the failure mode was — several comments
in this repo exist because the bug was invisible in a green test suite and
obvious the moment someone ran it. Keep that.

Do not delete a comment that names a hazard because the code "looks obvious now".
It looked obvious the first time too.
