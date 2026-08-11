import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Console from "@/components/console";
import LogoutButton from "@/components/logout-button";
import type { SeatSnapshot } from "@/components/seat-state";
import * as arena from "@/lib/arena";
import { explorerAddressUrl, networkKey, usdcBalance } from "@/lib/chain";
import type { AgentConfig } from "@/lib/agent";
import { autonomyStore } from "@/lib/chat/autonomy";
import { providerStatuses } from "@/lib/chat/providers/registry";
import { passwordRequired, sessionFrom } from "@/lib/auth";
import { config } from "@/lib/config";
import { capabilities } from "@/lib/registry";
import { SESSION_COOKIE } from "@/lib/session";
import { rules } from "@/lib/rules";
import { spendStore } from "@/lib/spend";
import { signedHeaders } from "@/lib/sign";
import type { ArenaChoice } from "@/lib/capability";
import type { HeldTitle, Standing } from "@/lib/standing";
import { address, hasWallet, selectedWalletId, wallets } from "@/lib/wallet";

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

/**
 * Where the operator stands: their record, their matches, their duels.
 *
 * Three reads, all through `arena.call` like `houseOf` above — this file is a
 * server component and the one-door invariant is about `arena.ts` being the
 * only module that reaches the canon, which it still is.
 *
 * **Every one of them is allowed to fail.** A standing is a convenience on a
 * screen whose actual job is to reach the arena, so a dead RPC or a disabled
 * feature leaves a section saying it could not be read, and the console keeps
 * working. That is the same choice `usdcBalance` and `houseOf` already make,
 * and it is why `unreachable` is a field rather than a thrown error.
 *
 * The duel read is SIGNED, which makes it the first signed request this page
 * issues. It is free and owner-only — the arena has no other way to answer
 * "what am I in", because the pool is anonymous by design.
 */
async function standingFor(
  me: string | null,
  seatBody: unknown,
  championWallet: string | null,
): Promise<Standing> {
  const seat = (seatBody ?? {}) as Record<string, unknown>;
  const base: Standing = {
    wallet: me,
    holdsThrone:
      me !== null && championWallet !== null && me.toLowerCase() === championWallet.toLowerCase(),
    championWallet,
    tookSeatAt: str(seat.tookSeatAt),
    tenureDefenses: typeof seat.tenureDefenses === "number" ? seat.tenureDefenses : null,
    jackpotUsdc: str(seat.currentJackpotUsdc),
    record: null,
    matches: [],
    duels: [],
    unreachable: { record: false, matches: false, duels: false },
  };

  if (!me) return base;
  const mine = me.toLowerCase();

  const [agentRead, boardRead, matchRead, duelRead] = await Promise.all([
    arena.call({ method: "GET", path: `/api/agent/${encodeURIComponent(me)}`, paid: false }),
    // The standing itself. `/api/agent` answers identity and titles; elo, wins,
    // losses and defenses are the leaderboard view's, and the arena's own rule
    // is that nothing computes a win rate for itself.
    arena.call({ method: "GET", path: "/api/leaderboard", paid: false }),
    arena.call({ method: "GET", path: "/api/matches", paid: false }),
    signedRead("/api/duels/mine", "duels:mine"),
  ]);

  // ── The record and the titles ──────────────────────────────────────────────
  if (agentRead.result?.ok) {
    const body = (agentRead.result.body ?? {}) as {
      agent?: { displayName?: unknown };
      titles?: unknown;
      duels?: { wins?: unknown; losses?: unknown };
    };
    const num = (v: unknown) => (typeof v === "number" ? v : null);

    // This wallet's row on the board, or none. The view is returned whole and
    // unpaged, so finding a row is a filter rather than a second request.
    const board = (boardRead.result?.ok ? boardRead.result.body : null) as {
      leaderboard?: unknown;
    } | null;
    const rows = Array.isArray(board?.leaderboard) ? board.leaderboard : [];
    const row = rows.find(
      (r) => str((r as { walletAddress?: unknown }).walletAddress)?.toLowerCase() === mine,
    ) as Record<string, unknown> | undefined;
    /*
      Titles are held by CHARACTERS and by AGENTS, and the catalogue publishes
      every title with its full holder list — so "which of these are mine" is a
      filter over holders, not a second read. A title whose holders this wallet
      is not in is simply somebody else's, and rendering the catalogue instead
      would put every belt in the arena on the operator's own card.
    */
    const titles: HeldTitle[] = [];
    for (const raw of Array.isArray(body.titles) ? body.titles : []) {
      const t = raw as {
        slug?: unknown;
        display?: unknown;
        predicate?: unknown;
        holders?: unknown;
      };
      const holders = Array.isArray(t.holders) ? t.holders : [];
      const held = holders.some(
        (h) => str((h as { agentWallet?: unknown }).agentWallet)?.toLowerCase() === mine,
      );
      if (!held) continue;
      const slug = str(t.slug);
      const display = str(t.display);
      if (slug && display) titles.push({ slug, display, predicate: str(t.predicate) });
    }

    base.record = {
      displayName: str(body.agent?.displayName),
      elo: num(row?.elo),
      wins: num(row?.wins),
      losses: num(row?.losses),
      // The board's LIFETIME defenses. The seat read owns the tenure count, and
      // the two are different numbers that are equal until the first vest.
      defenses: num(row?.defenses),
      rank: str(row?.rank),
      winRate: str(row?.winRate),
      earningsUsdc: str(row?.earningsUsdc),
      titles,
      duelWins: num(body.duels?.wins),
      duelLosses: num(body.duels?.losses),
    };
  } else {
    base.unreachable.record = true;
  }

  // ── The matches this wallet was in ─────────────────────────────────────────
  if (matchRead.result?.ok) {
    const body = (matchRead.result.body ?? {}) as { matches?: unknown };
    const rows = Array.isArray(body.matches) ? body.matches : [];
    for (const raw of rows) {
      const m = raw as Record<string, unknown>;
      const side = (n: string) =>
        str((m[n] as { walletAddress?: unknown } | undefined)?.walletAddress);
      const champ = side("champion");
      const chall = side("challenger");
      const isChamp = champ?.toLowerCase() === mine;
      const isChall = chall?.toLowerCase() === mine;
      if (!isChamp && !isChall) continue;
      const id = str(m.id);
      if (!id) continue;
      base.matches.push({
        id,
        side: isChamp ? "champion" : "challenger",
        opponent: isChamp ? chall : champ,
        outcome: str(m.outcome),
        status: str(m.status),
        potAtStakeUsdc: str(m.potAtStakeUsdc),
        endedAt: str(m.endedAt),
        createdAt: str(m.createdAt),
      });
    }
  } else {
    base.unreachable.matches = true;
  }

  // ── The duels this wallet is in ────────────────────────────────────────────
  if (duelRead?.result?.ok) {
    const body = (duelRead.result.body ?? {}) as { duels?: unknown };
    for (const raw of Array.isArray(body.duels) ? body.duels : []) {
      const d = raw as Record<string, unknown>;
      if (typeof d.id !== "number") continue;
      const n = (v: unknown) => (typeof v === "number" ? v : null);
      base.duels.push({
        id: d.id,
        state: str(d.state) ?? "unknown",
        live: d.live === true,
        arenaSlug: str(d.arenaSlug),
        stakeUsdc: str(d.stakeUsdc),
        viewer: str(d.viewer),
        yourCharacterId: n(d.yourCharacterId),
        opponentCharacterId: n(d.opponentCharacterId),
        winnerCharacterId: n(d.winnerCharacterId),
        revealed: d.revealed === true,
        listedAt: str(d.listedAt),
      });
    }
  } else {
    /*
      Not necessarily an error. `duels_mine` sits behind DUELS_ENABLED, so a
      deploy with duels off answers a refusal and the section says it could not
      be read — which is honest, and better than an empty list that would claim
      this wallet is in no duels.
    */
    base.unreachable.duels = true;
  }

  return base;
}

/**
 * One signed GET, or null when there is no key to sign with.
 *
 * `signedHeaders` throws `NoWalletError` on a keyless deploy rather than
 * returning null, and this page renders on keyless deploys — so the read is
 * wrapped rather than guarded by a second `hasWallet()` call that could drift
 * from the one inside it.
 */
async function signedRead(path: string, scope: string) {
  try {
    return await arena.call({
      method: "GET",
      path,
      paid: false,
      headers: await signedHeaders(scope, "GET", path),
    });
  } catch {
    return null;
  }
}

/**
 * The arenas, for the fields that name one.
 *
 * Read rather than enumerated. `GET /api/rules` publishes only the arena the
 * cycle is RUNNING in, and a duel may be posted in any that is not retired — so
 * the list comes from `/api/arenas`, which is the canon's own answer to "which
 * ones exist". A copy of the eight in this repo would be game data in a client,
 * wrong the day one retires.
 *
 * Free, unauthenticated, and allowed to fail: an empty list makes the field a
 * plain text box again, which is exactly what it was before.
 */
async function arenaList(): Promise<ArenaChoice[]> {
  const read = await arena.call({ method: "GET", path: "/api/arenas", paid: false });
  if (!read.result?.ok) return [];
  const body = (read.result.body ?? {}) as { arenas?: unknown };
  const rows = Array.isArray(body.arenas) ? body.arenas : [];
  const out: ArenaChoice[] = [];
  for (const raw of rows) {
    const a = raw as { slug?: unknown; displayName?: unknown; running?: unknown };
    const slug = str(a.slug);
    if (!slug) continue;
    out.push({
      slug,
      // The arena's own label, or the slug when it published none. Never a
      // title-cased slug: that would be this console naming a place.
      displayName: str(a.displayName) ?? slug,
      running: a.running === true,
    });
  }
  return out;
}

/** Whatever the seat read returned, labelled. Nothing derived, nothing ticked. */
function snapshot(
  body: unknown,
  reachable: boolean,
  fetchedAtIso: string,
  me: string | null,
): SeatSnapshot {
  const seat = (body ?? {}) as Record<string, unknown>;
  /*
    The champion is an OBJECT, and reading it as a string showed "—" on a seat
    this console was sitting on.

    `GET /api/seat` answers `champion: { displayName, wallet, elo, wins, losses,
    lifetimeDefenses }`. `str()` returns null for anything that is not a
    non-empty string, so the field was silently null on every read — including
    the one where the operator had just taken the throne, with `tookSeatAt` and
    the jackpot right beside it filled in. A wrong "nobody holds the seat" on
    the one card that answers "who holds the seat" is worse than a blank, and it
    read as an arena problem rather than a parsing one.

    The WALLET, not the display name: `displayName` is itself a shortened
    address for an unnamed agent ("0x38a4…c154"), so rendering it would truncate
    an already-truncated string and could never be compared to anything.
  */
  const champion = (seat.champion ?? null) as { wallet?: unknown } | null;
  const championWallet = champion ? str(champion.wallet) : null;

  // The fighter on the seat. Published as a pair by the arena — name and id
  // together or not at all — so a half-answer is not representable here.
  const fighter = (seat.reigningCharacter ?? null) as {
    id?: unknown;
    name?: unknown;
    imageUrl?: unknown;
  } | null;
  const reigningCharacter =
    fighter && typeof fighter.id === "number" && str(fighter.name)
      ? {
          id: fighter.id,
          name: str(fighter.name)!,
          // Resolved by the arena. The console never composes an asset path —
          // a URL built here would be a second copy of where the objects live,
          // and it would break silently the day the prefix moves.
          imageUrl: str(fighter.imageUrl),
        }
      : null;

  return {
    fetchedAtIso,
    reachable,
    champion: championWallet,
    reigningCharacter,
    /*
      Whether the seat is THIS console's.

      Compared here rather than in the browser, and it is a comparison of two
      strings the server already holds — not a rule. The console is forbidden
      from deciding anything about the game; it is not forbidden from noticing
      that two addresses it was given are the same one.

      Lowercased on both sides because they do not agree on case: the seat read
      returns a lowercase wallet and `wallet.ts` derives a checksummed one.
    */
    isMine: championWallet !== null && me !== null && championWallet.toLowerCase() === me.toLowerCase(),
    tookSeatAt: str(seat.tookSeatAt),
    tenureDefenses: typeof seat.tenureDefenses === "number" ? seat.tenureDefenses : null,
    jackpotUsdc: str(seat.currentJackpotUsdc),
    liveMatchId: str(seat.liveMatchId),
    network: str(seat.network),
  };
}

export default async function Page() {
  const cfg = config();

  /*
    The door, above `rules()` and therefore above every outbound request.

    This page issues eight arena reads before it renders. An unauthenticated
    navigation must cause none of them — otherwise anyone who finds the URL can
    make this process spend its own rate limit against the canon, which is an
    amplifier rather than a disclosure but is no better for being one.

    It also gates a genuine disclosure. Everything below this line is the
    operator's: the wallet address, the USDC balance, the spend ledger, the
    House, the standing. None of it can spend, and all of it names who is
    running this console.

    `redirect()` throws a control-flow error that Next catches. It is not inside
    a try/catch here and must not be moved into one — a `catch` around it turns a
    redirect into a swallowed exception and renders the page anyway.
  */
  if (passwordRequired()) {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if ((await sessionFrom(token)) !== "valid") redirect("/login");
  }

  const live = await rules();

  const seatRead = await arena.call({ method: "GET", path: "/api/seat", paid: false });
  const reachable = seatRead.result?.ok === true;

  const me = address();
  const keyed = hasWallet();
  const allWallets = wallets();

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

  const seatBody = seatRead.result?.body;
  const championWallet =
    str(((seatBody ?? {}) as { champion?: { wallet?: unknown } }).champion?.wallet) ?? null;
  const standing = await standingFor(me, seatBody, championWallet);

  const arenas = await arenaList();

  const ledger = await spendStore().read();

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
        arenas={arenas}
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
                // Labels and addresses. No key, and no means of asking for one:
                // `wallets()` maps the private entries down to descriptors and
                // `lib/operator.ts` holds the type so no component ever has an
                // import edge to the module that built them.
                choices: allWallets,
                selectedId: selectedWalletId() ?? "",
              }
            : null
        }
        house={house}
        seat={snapshot(seatRead.result?.body, reachable, new Date().toISOString(), me)}
        standing={standing}
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
            The ceiling is a seatbelt in this app&rsquo;s own process — it bounds one sitting,
            across every wallet you have configured, and protects against a stray click. It is not
            escrow, and it does not protect a host you do not control. It is not a record either:
            what these wallets actually spent is on-chain, and every match the arena settles is
            public on its own pages.
          </>
        ) : (
          <>
            Read-only. This deploy holds no key, so nothing here can spend or sign. Add{" "}
            <code>DETHRONE_PRIVATE_KEY</code> to <code>.env.local</code> and restart to forge,
            challenge and duel — with a wallet that exists only for this console.
          </>
        )}
        {/*
          Only where there is a door to close. On a loopback run with no password
          the bind is the protection, and a "Log out" that ends nothing would be
          a control that lies about what it does.
        */}
        {cfg.passwordRequired ? <LogoutButton /> : null}
      </footer>
    </div>
  );
}
