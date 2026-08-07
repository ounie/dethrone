import Image from "next/image";
import Console from "@/components/console";
import * as arena from "@/lib/arena";
import type { Capabilities, Capability } from "@/lib/capability";
import { COMMANDS, type Command } from "@/lib/commands";
import { config } from "@/lib/config";
import { rules } from "@/lib/rules";
import { address, hasWallet } from "@/lib/wallet";

/**
 * The one server component.
 *
 * It resolves the three facts the header states — base URL, operator address,
 * seat reachability — and computes, on the server, which commands this deploy
 * can actually run. The browser receives that verdict as data. **It never
 * receives a key, a signature-producing capability, or the means to decide for
 * itself that a paid command is available.**
 *
 * `force-dynamic` because every number on this screen is money. A cached seat
 * read rendering a stale pot is a wrong number, and a wrong number is worse
 * than a slow one.
 */
export const dynamic = "force-dynamic";

function capability(
  cmd: Command,
  ctx: { hasKey: boolean; allowGenesis: boolean; live: Awaited<ReturnType<typeof rules>> },
): Capability {
  const liveCents = cmd.livePrice ? ctx.live.money[cmd.livePrice] : undefined;

  if (cmd.requiresOptIn && !ctx.allowGenesis) {
    return {
      enabled: false,
      reason: `Not registered on this deploy. Set ${cmd.requiresOptIn}=true to add it.`,
      liveCents,
    };
  }

  if ((cmd.tier === "paid" || cmd.tier === "signed") && !ctx.hasKey) {
    return {
      enabled: false,
      reason:
        cmd.tier === "paid"
          ? "Read-only: this deploy holds no key, so nothing here can spend."
          : "Read-only: this deploy holds no key, so nothing here can prove a wallet.",
      liveCents,
    };
  }

  if (cmd.tier === "paid" && !ctx.live.interfaceMatches) {
    return {
      enabled: false,
      reason: `The arena reports ${ctx.live.interfaceVersion}; this console was written against interface-v2. Reads still work; nothing will spend.`,
      liveCents,
    };
  }

  // `duels` is the one flag the canon publishes directly. Everything else is
  // discovered the honest way — by asking and reading the 404 — rather than
  // guessed at here, because a guess is the console deciding a rule.
  if (cmd.requiresFlag === "duels" && ctx.live.reachable && !ctx.live.duel.enabled) {
    return { enabled: false, reason: "Duels are closed on this server.", liveCents };
  }

  return { enabled: true, liveCents };
}

export default async function Page() {
  const cfg = config();
  const live = await rules();

  const seat = await arena.call({ method: "GET", path: "/api/seat", paid: false });
  const reachable = seat.result?.ok === true;

  const me = address();
  const keyed = hasWallet();

  const capabilities: Capabilities = {};
  for (const cmd of COMMANDS) {
    capabilities[cmd.id] = capability(cmd, {
      hasKey: keyed,
      allowGenesis: cfg.allowGenesis,
      live,
    });
  }

  return (
    <div className="shell">
      <header className="masthead">
        <div className="masthead-lockup">
          {/* Artwork, not an icon. The adjacent text carries the whole claim. */}
          <Image src="/brand/logo-crown.webp" alt="" width={512} height={452} priority />
          <span className="display wordmark">Console</span>
        </div>

        <dl className="fact">
          <dt>Arena</dt>
          <dd title={cfg.baseUrl}>{cfg.baseUrl}</dd>
        </dl>

        <dl className="fact">
          <dt>Operator</dt>
          <dd data-tone={me ? undefined : "readonly"} title={me ?? undefined}>
            {me ?? "read-only — no key set"}
          </dd>
        </dl>

        <dl className="fact">
          <dt>Seat</dt>
          <dd data-tone={reachable ? "ok" : "bad"}>{reachable ? "reachable" : "unreachable"}</dd>
        </dl>

        <dl className="fact">
          <dt>Ceiling</dt>
          <dd
            data-tone={cfg.ceilingEnabled ? undefined : "warn"}
            title={cfg.ceilingDisabledReason}
          >
            {/* Never a number when it cannot bound a sitting. A disabled seatbelt
                that announces itself beats one that silently resets. */}
            {cfg.ceilingEnabled ? `${cfg.maxSpendCents}¢ / sitting` : "disabled"}
          </dd>
        </dl>
      </header>

      {/* The address is public. The key never crosses this boundary. */}
      <Console
        operator={me}
        capabilities={capabilities}
        forgeNote={live.forgeNote}
        stakeRange={live.duel}
        ceilingEnabled={cfg.ceilingEnabled}
      />

      <footer className="footnote">
        {keyed ? (
          <>
            The ceiling is a seatbelt in this app&rsquo;s own process — it bounds one sitting and
            protects against a stray click. It is not escrow, and it does not protect a host you do
            not control. Reconciliation is the arena&rsquo;s: <code>GET /api/treasury</code> is the
            ledger.
          </>
        ) : (
          <>
            Read-only. This deploy holds no key, so nothing here can spend or sign. Add{" "}
            <code>DETHRONE_PRIVATE_KEY</code> to <code>.env.local</code> and restart to forge,
            challenge and duel — with a wallet that exists only for this console.
          </>
        )}
      </footer>
    </div>
  );
}
