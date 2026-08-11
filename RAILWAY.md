# Running this on Railway

The console's default protection is the loopback bind: `pnpm dev` and `pnpm start`
listen on `127.0.0.1`, so the only person who can reach a wallet that spends is
whoever is sitting at the machine. A hosted container has no equivalent — the
platform gives it a public URL the moment it is up, and puts nothing in front of
it. `CONSOLE_PASSWORD` is what replaces the bind.

## What the config does

`railway.json` sets three things, and each of them is load-bearing:

- **`startCommand: pnpm start:hosted`** — the default `start` script binds
  `127.0.0.1` on a fixed port, which on Railway means the proxy can never reach
  the container and the deploy looks hung. `start:hosted` binds `0.0.0.0` and
  honours `$PORT`. It also exports `HOST`, so `instrumentation.ts` — which runs
  in a child process that cannot see the CLI's `--hostname` — can check the bind
  rather than warning that it is unknown.
- **`numReplicas: 1`** — the spend ceiling is an in-memory counter over one
  process lifetime. That is a real bound on a single long-lived container, which
  is why Railway needs no KV store where Vercel does. **Two replicas is two
  ceilings**, silently: each would let a full sitting's worth through. If you
  ever need to scale this, set `KV_REST_API_URL` and `KV_REST_API_TOKEN` first.
- **`buildCommand: pnpm build`** — which runs `scripts/assert-config.ts` before
  `next build`. That matters: a deploy holding a key with no password fails the
  **build**, not merely the boot, so it never becomes a running URL at all.

## Required environment variables

| Variable | Why |
|---|---|
| `CONSOLE_PASSWORD` | The door. Minimum 12 characters — assertion 12 refuses a shorter one. **Required** whenever a wallet key is also set; assertion 11 refuses the build otherwise. |
| `DETHRONE_PRIVATE_KEY` | Optional. Leave it out for a read-only spectator deploy, which needs no password because it has nothing to protect. |
| `CONSOLE_MAX_SPEND_CENTS` | The sitting ceiling. Worth setting deliberately here rather than taking the default. |

**Use a wallet that exists only for this deploy.** The threat model is "someone
reaches this URL", and the mitigation that always works regardless of how good
the password is: fund it with the sitting's budget and nothing more.

## What is still refused here

`CONSOLE_ALLOW_FULL_AUTONOMY` does not work on Railway, and the password does not
unlock it. A login proves a browser belongs to the operator; it does not
supervise a machine that decides for itself when to spend. Assertion 9 refuses
the build.

## Health checks

Deliberately not configured. With a password set, `GET /` is a redirect to
`/login`, and a health check that treats a 307 as a failure makes a correct
deploy look broken. If you want one, point it at `/login` — it returns 200 and
discloses nothing.

## Logging out everywhere

There is no session table, so there is nothing to clear. Change
`CONSOLE_PASSWORD` and redeploy: the cookie's signing key is derived from the
password, so every token ever minted stops verifying at once.
