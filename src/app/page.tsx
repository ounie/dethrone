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

/**
 * The wallet's House, as the arena reports it.
 *
 * Returns null on anything unexpected — an unreachable arena, Houses switched
 * off, a body that does not carry the field. Never a guess: an operator shown
 * the wrong House would have no way to tell, because the correct answer is a
 * hash of their own address.
 */
async function houseOf(wallet: string): Promise<{ slug: string; name: string } | null> {
  const read = await arena.call({
    method: "GET",
    // Encoded here for the same reason `/api/act` encodes its segments: this is
    // an address from configuration, not from a form, and the habit is cheaper
    // than the exception.
    path: `/api/derive/${encodeURIComponent(wallet)}`,
    paid: false,
  });
  if (!read.result?.ok) return null;
  const body = (read.result.body ?? {}) as { house?: { slug?: unknown; name?: unknown } };
  const slug = str(body.house?.slug);
  const name = str(body.house?.name);
  return slug && name ? { slug, name } : null;
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

  /*
    The operator's House.

    A House is a pure function of the wallet address — `houseAssign(address)`,
    the same one argument the genome takes — so this console could compute it in
    four lines and must not. It is a game rule, the eight-entry table is the
    arena's, and a second copy here would be silently wrong the day the mapping
    versions, on a label the operator has no way to check.

    So it is READ, from the free `/api/derive/{address}` — which exists to answer
    exactly this ("your wallet already contains a fighter") and publishes
    `house` only when the arena has Houses switched on. A deploy with the flag
    down gets no field, renders no crest, and infers nothing from the absence.

    Free, unauthenticated, and cacheable forever by the arena's own headers, so
    this costs the page nothing beyond one request it can afford to lose: a
    failure leaves `house` null and the masthead simply has no crest in it.
  */
  const house = me ? await houseOf(me) : null;

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
        sequenceLength={live.actions.sequenceLength}
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
        house={house}
        seat={snapshot(seatRead.result?.body, reachable, new Date().toISOString())}
      />

      <footer className="footnote">
        {keyed ? (
          <>
            {/*
              This used to end "Reconciliation is the arena's: GET /api/treasury
              is the ledger." That route is ADMIN_TOKEN and always has been —
              `commands.ts` excludes it for exactly that reason, so this file
              and the catalogue disagreed with each other in print. Naming an
              endpoint the reader cannot call, as their receipt, is worse than
              naming none: it reads as an audit trail right up until the 401.
            */}
            The ceiling is a seatbelt in this app&rsquo;s own process — it bounds one sitting and
            protects against a stray click. It is not escrow, and it does not protect a host you do
            not control. It is not a record either: what this wallet actually spent is on-chain, and
            every match the arena settles is public on its own pages.
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
