import Console from "@/components/console";
import type { SeatSnapshot } from "@/components/seat-state";
import * as arena from "@/lib/arena";
import { explorerAddressUrl, networkKey, usdcBalance } from "@/lib/chain";
import type { AgentConfig } from "@/lib/agent";
import { autonomyStore } from "@/lib/chat/autonomy";
import { providerStatuses } from "@/lib/chat/providers/registry";
import { config } from "@/lib/config";
import { capabilities } from "@/lib/registry";
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

  // One implementation, shared with the agent's tool surface. See lib/registry.
  const caps = await capabilities(live);

  // The agent, resolved server-side for the same reason the capabilities are:
  // the browser is handed verdicts and sentences, never the means to work out
  // for itself whether a key exists.
  const providers = await providerStatuses();
  const firstProvider =
    providers.find((p) => p.id === cfg.chatDefaultProvider && p.available) ??
    providers.find((p) => p.available);
  const autonomy = autonomyStore(me);

  const agent: AgentConfig = {
    enabled: !!firstProvider,
    ...(firstProvider
      ? {}
      : {
          reason:
            "No model provider is configured. Set one of OPENROUTER_API_KEY, ANTHROPIC_API_KEY or OPENAI_COMPATIBLE_BASE_URL in .env.local — or run this console on your own machine, where a Claude Max subscription needs no key at all.",
        }),
    providers,
    defaultProviderId: firstProvider?.id ?? null,
    defaultModelId: firstProvider?.models[0]?.id ?? null,
    autonomy: {
      offerable: autonomy.offerable,
      ...(autonomy.reason ? { reason: autonomy.reason } : {}),
      active: autonomy.mode() === "full",
      perActionCapCents: autonomy.offerable ? cfg.autonomyMaxCents : null,
    },
  };

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
        capabilities={caps}
        agent={agent}
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
