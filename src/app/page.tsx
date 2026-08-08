import Console from "@/components/console";
import type { SeatSnapshot } from "@/components/seat-state";
import * as arena from "@/lib/arena";
import { explorerAddressUrl, networkKey, usdcBalance } from "@/lib/chain";
import type { Capabilities, Capability } from "@/lib/capability";
import { COMMANDS, type Command } from "@/lib/commands";
import { config } from "@/lib/config";
import { rules } from "@/lib/rules";
import { spendStore } from "@/lib/spend";
import { address, hasWallet } from "@/lib/wallet";

/**
 * The one server component.
 *
 * It reads the seat, resolves which commands this deploy can actually run, and
 * hands the browser a verdict. **The browser never receives a key, a
 * signature-producing capability, or the means to decide for itself that a paid
 * command is available.** It receives an address, which is public, and a set of
 * booleans somebody else computed.
 *
 * `force-dynamic` because every number here is money. A cached seat read
 * showing a stale pot is a wrong number, and a wrong number is worse than a
 * slow one.
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

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Whatever the seat read returned, labelled. Nothing derived, nothing ticked. */
function snapshot(body: unknown, reachable: boolean, fetchedAtIso: string): SeatSnapshot {
  const seat = (body ?? {}) as Record<string, unknown>;
  return {
    fetchedAtIso,
    reachable,
    champion: str(seat.champion),
    tookSeatAt: str(seat.tookSeatAt),
    tenureDefenses: typeof seat.tenureDefenses === "number" ? seat.tenureDefenses : null,
    jackpotUsdc: str(seat.currentJackpotUsdc),
    liveMatchId: str(seat.liveMatchId),
    network: str(seat.network),
  };
}

export default async function Page() {
  const cfg = config();
  const live = await rules();

  const seatRead = await arena.call({ method: "GET", path: "/api/seat", paid: false });
  const reachable = seatRead.result?.ok === true;

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

  const ledger = await spendStore(me).read();

  // A read of the chain, not of the canon: one `view` call, no key, no
  // signature. `null` when the RPC is unreachable — the console keeps working.
  const balance = me ? await usdcBalance(me) : null;

  return (
    <div className="shell">
      {/* The address is public. The key never crosses this boundary. */}
      <Console
        operator={me}
        baseUrl={cfg.baseUrl}
        capabilities={capabilities}
        forgeNote={live.forgeNote}
        stakeRange={live.duel}
        ceiling={{
          enabled: cfg.ceilingEnabled,
          spentCents: ledger?.spentCents ?? 0,
          capCents: ledger?.cap ?? cfg.maxSpendCents,
          reason: cfg.ceilingDisabledReason,
        }}
        wallet={
          me
            ? {
                address: me,
                usdc: balance?.usdc ?? null,
                network: balance?.network ?? networkKey(),
                explorerUrl: explorerAddressUrl(me),
              }
            : null
        }
        seat={snapshot(seatRead.result?.body, reachable, new Date().toISOString())}
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
