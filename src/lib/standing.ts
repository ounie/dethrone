/**
 * Where this console's operator stands, as the arena reports it.
 *
 * A value-free type module, for the reason `capability.ts`, `agent.ts` and
 * `operator.ts` are: it is produced on the server — beside the wallet, in
 * `page.tsx` — and rendered by a client component that must never have an
 * import edge to anything holding a key. `test/deps.test.ts` enrols it.
 *
 * ## Everything here was READ, and nothing was worked out
 *
 * That is the whole discipline of this file and it is worth naming, because a
 * "your standing" card is exactly where a console starts quietly implementing
 * the game. There is no eligibility here, no "you could challenge", no derived
 * rank, no computed record. Four reads answer four questions and the card
 * renders their answers:
 *
 *   - the seat says who holds the throne, so `holdsThrone` is one address
 *     compared against another;
 *   - `/api/agent/{wallet}` says what this wallet's record and titles are;
 *   - `/api/matches` says which matches happened and how they ended;
 *   - `/api/duels/mine` says which duels this wallet is in.
 *
 * The one thing computed anywhere is `holdsThrone`, and it is a string
 * comparison between two values the server already held. Noticing that two
 * addresses are equal is not a rule about the game.
 */

/** One title this wallet holds, exactly as the arena named it. */
export interface HeldTitle {
  slug: string;
  /** The arena's own display string. Never composed here. */
  display: string;
  /** The arena's English predicate — why it is held. Rendered verbatim. */
  predicate: string | null;
}

/**
 * This wallet's record.
 *
 * ## It comes from the LEADERBOARD, not from the agent read
 *
 * The obvious source is `/api/agent/{wallet}`, and it does not publish these:
 * that route answers identity, titles and a duel record, and its `agent` object
 * is `{ id, wallet, displayName }` and nothing more. Elo, wins, losses and
 * defenses live on the `leaderboard` view, which is the arena's single source
 * for a standing — its own rule is that no page computes a win rate itself.
 *
 * Reading the agent route for them produced a card showing "Elo —" beside a
 * wallet that had just taken the throne, which is the same class of quiet
 * wrongness as the champion field it sits under.
 */
export interface Record_ {
  displayName: string | null;
  elo: number | null;
  wins: number | null;
  losses: number | null;
  defenses: number | null;
  /** The arena's own dense rank, as a string. Never recomputed here. */
  rank: string | null;
  /** The view's own ratio, rendered as given. */
  winRate: string | null;
  earningsUsdc: string | null;
  titles: HeldTitle[];
  /** The duel record from `/api/agent/{wallet}`, which is where it lives. */
  duelWins: number | null;
  duelLosses: number | null;
}

/** One throne match this wallet was in, from `/api/matches`. */
export interface MyMatch {
  id: string;
  /** `champion` or `challenger` — which side this wallet was on. */
  side: "champion" | "challenger";
  /** The other wallet. Public: a resolved throne match is public on its own page. */
  opponent: string | null;
  /** The arena's own vocabulary: DEFENDED, SEAT_TAKEN, or null while unresolved. */
  outcome: string | null;
  status: string | null;
  potAtStakeUsdc: string | null;
  endedAt: string | null;
  createdAt: string | null;
}

/** One duel this wallet hosts or took, from `/api/duels/mine`. */
export interface MyDuel {
  id: number;
  state: string;
  /** The arena's own partition of its own state machine. Not inferred here. */
  live: boolean;
  arenaSlug: string | null;
  stakeUsdc: string | null;
  /** `host` or `taker`. */
  viewer: string | null;
  /** Yours. A participant always sees their own commitment. */
  yourCharacterId: number | null;
  /** Sealed until the duel reveals — null is the arena's answer, not a gap. */
  opponentCharacterId: number | null;
  winnerCharacterId: number | null;
  revealed: boolean;
  listedAt: string | null;
}

export interface Standing {
  /** Null on a read-only deploy: there is no wallet to have a standing. */
  wallet: string | null;
  /** Whether the operator's wallet is the one on the seat right now. */
  holdsThrone: boolean;
  /** Whoever does hold it, when it is not this wallet. */
  championWallet: string | null;
  tookSeatAt: string | null;
  tenureDefenses: number | null;
  jackpotUsdc: string | null;
  record: Record_ | null;
  matches: MyMatch[];
  duels: MyDuel[];
  /**
   * Set when a read did not come back.
   *
   * Rendered as a sentence beside the section it belongs to, never swallowed:
   * an empty list and an unreachable read look identical on screen otherwise,
   * and "you have no matches" is a different claim from "we could not ask".
   */
  unreachable: { record: boolean; matches: boolean; duels: boolean };
}
