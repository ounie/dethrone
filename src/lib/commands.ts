/**
 * The command catalogue.
 *
 * ## What this file is allowed to contain
 *
 * Paths, methods, input shapes, price **labels**, and the two ceiling defaults.
 * That is the complete list. It is shared by the client and the route, carries
 * no secrets, and is safe in the browser bundle.
 *
 * ## What it must never contain
 *
 * A rule. The moment this file decides whether a forge window has closed, or
 * what a stake is worth, or which command is legal right now, there are two
 * implementations of the game and they will disagree on the day it matters.
 *
 * The `price` strings here are **labels for humans**. The real number comes from
 * `GET /api/rules` (for the fixed fees, via `livePrice`) or from the 402 body
 * (for everything else). `cents` is a local seatbelt, not an authority — it
 * exists so the ceiling has something to check before a request leaves the
 * process, and it is deliberately allowed to be stale.
 *
 * This is also the only file under `src/` permitted to hold a currency literal;
 * `test/currency-literals.test.ts` asserts that `src/app/**` and
 * `src/components/**` hold none.
 */

/** The default ceiling for one sitting, in cents. Overridden by CONSOLE_MAX_SPEND_CENTS. */
export const DEFAULT_MAX_SPEND_CENTS = 500;

/** Above this, a paid command needs an explicit confirmation. Overridden by env. */
export const DEFAULT_CONFIRM_OVER_CENTS = 100;

/**
 * The most one *autonomous* action may cost, in cents. Overridden by
 * CONSOLE_AUTONOMY_MAX_CENTS.
 *
 * This is the machine's stand-in for `DEFAULT_CONFIRM_OVER_CENTS`, and the
 * asymmetry is the point: above the confirm threshold a human is asked and may
 * say yes, whereas above this cap an agent is simply refused. There is nobody
 * to ask, so the only safe answer is no. Deliberately far below the sitting
 * ceiling — a per-action cap equal to the ceiling would let one bad turn spend
 * the whole sitting, which is not a per-action cap at all.
 */
export const DEFAULT_AUTONOMY_MAX_CENTS = 25;

/** `cents` sentinel: the caller names the amount, so the catalogue cannot know it. */
export const CALLER_PRICED = -1;

/**
 * `actions` is a sequence of menu indices, and it is its own kind because it is
 * the one input on this screen that a text box cannot honestly represent: the
 * legal menu is a pure function of a fighter's genome, so the field has to go
 * and fetch it before it can offer anything.
 */
export type FieldKind = "text" | "number" | "select" | "boolean" | "actions";

export interface Field {
  name: string;
  label: string;
  placeholder?: string;
  kind?: FieldKind;
  /** For `kind: "select"`. Values are sent verbatim. */
  options?: readonly string[];
  optional?: boolean;
  /** Rendered under the input. The canon's words where there are any. */
  hint?: string;
}

export type Tier = "free" | "signed" | "paid";

export type Group = "Read" | "Stable" | "Fight" | "Market" | "Court";

/** Kill switches the canon exposes. A flagged route 404s when its feature is off. */
export type FeatureFlag =
  | "duels"
  | "heirMarket"
  | "lordships"
  | "houses"
  | "undercard"
  | "filmOrders"
  | "genesis"
  | "court";

export interface Command {
  id: string;
  label: string;
  tier: Tier;
  group: Group;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** `:name` segments bind to a field of the same name and are encoded individually. */
  path: string;
  /** Display only. Never used to compute anything. */
  price: string;
  /** 0 free · CALLER_PRICED · else the seatbelt hint in cents. */
  cents: number;
  /**
   * Key into `GET /api/rules`'s `money` block. When present the rail renders the
   * live number in place of the label above, which is the whole reason the rules
   * are published.
   */
  livePrice?: "forge" | "challenge" | "filmOrder";
  /**
   * The EIP-191 scope template. `{name}` interpolates from the same args as the
   * path. The canon's scope embeds the id — `character:12`, not `character` —
   * and a scope that disagrees by one character fails as a bare 401.
   */
  signScope?: string;
  /** Which field names the spend, for `cents: CALLER_PRICED`. */
  amountField?: string;
  /**
   * Caller-priced commands whose price the *server* holds (a listing, an
   * exhibition tier). The operator names a maximum instead; the 402's offer is
   * refused above it, before anything is signed.
   */
  maxField?: boolean;
  requiresFlag?: FeatureFlag;
  /** Requires an explicit opt-in env var to appear at all. */
  requiresOptIn?: "CONSOLE_ALLOW_GENESIS";
  /** Irreversible and not a payment. The confirmation names what is destroyed. */
  destructive?: boolean;
  fields?: readonly Field[];
  /** Rendered verbatim. Prefer the canon's own sentence where it publishes one. */
  note?: string;
}

const ADDRESS_HINT = "0x… — defaults to the operator's address";

export const COMMANDS: readonly Command[] = [
  // ───────────────────────────────────────────────────────────────────────────
  // Read — free forever, no wallet, no signature.
  //
  // Grouped by cost rather than by feature, because cost is the only access
  // control in this system and it is the one true statement the console can
  // make about the arena without importing a rule.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "rules",
    label: "Rules",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/rules",
    price: "free",
    cents: 0,
    fields: [
      { name: "arenas", label: "Include all arenas", kind: "boolean", optional: true },
      { name: "genesis", label: "Include genesis manifest", kind: "boolean", optional: true },
    ],
    note: "The published contract: forge rules, the rubric, the money splits, the vesting clock and the interface version. Everything the console knows about prices comes from here.",
  },
  {
    id: "seat",
    label: "The seat",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/seat",
    price: "free",
    cents: 0,
    note: "The reigning character, the jackpot's composition, and how to challenge it.",
  },
  {
    id: "queue",
    label: "Queue",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/queue",
    price: "free",
    cents: 0,
    note:
      "Throne matches not yet resolved, each with its queue state, when it was paid for and its " +
      "position in line.",
  },
  {
    id: "arena",
    label: "Current arena",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/arena",
    price: "free",
    cents: 0,
    note: "The arena this cycle is running in — its name, its ground and its plate hash.",
  },
  {
    id: "arenas",
    label: "All arenas",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/arenas",
    price: "free",
    cents: 0,
    note: "All eight arenas with their names and plate hashes, and which one is running now.",
  },
  {
    id: "derive",
    label: "Derive a fighter",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/derive/:address",
    price: "free",
    cents: 0,
    fields: [
      { name: "address", label: "Wallet", placeholder: ADDRESS_HINT, optional: true },
    ],
    note: "Byte-identical to what a forge would produce for that wallet. Immutable — cache it forever.",
  },
  {
    id: "match",
    label: "Match",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/match/:id",
    price: "free",
    cents: 0,
    fields: [{ name: "id", label: "Match id" }],
    note: "Redacted until the verdict lands. To see your own side early, use “My match” — it proves the wallet with a signature.",
  },
  {
    id: "matches",
    label: "History",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/matches",
    price: "free",
    cents: 0,
    fields: [
      {
        name: "status",
        label: "Status",
        kind: "select",
        options: ["", "active", "completed"],
        optional: true,
      },
    ],
    note:
      "Throne matches newest first, with both agents, the pot at stake and the outcome. Filter with " +
      "status.",
  },
  {
    id: "character",
    label: "Character",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/character/:id",
    price: "free",
    cents: 0,
    fields: [{ name: "id", label: "Character id", kind: "number" }],
    note:
      "One fighter in full: derived name, portrait, traits, its legal actions in wire order, and its " +
      "whole fight record.",
  },
  {
    id: "agent",
    label: "Agent",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/agent/:id",
    price: "free",
    cents: 0,
    fields: [{ name: "id", label: "Wallet or agent id", placeholder: ADDRESS_HINT }],
    note:
      "One agent's identity — wallet, display name and the titles it holds. Takes a wallet address or a " +
      "numeric id.",
  },
  {
    id: "titles",
    label: "Titles",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/titles",
    price: "free",
    cents: 0,
    note:
      "The whole title catalogue: every belt, record and mark, its predicate in English, and who holds " +
      "it.",
  },
  {
    id: "hall_of_fame",
    label: "Hall of fame",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/hall-of-fame",
    price: "free",
    cents: 0,
    note:
      "Two rosters — the fighters that have vested, and the losing challengers the crowd marked " +
      "beloved.",
  },
  {
    id: "leaderboard",
    label: "Leaderboard",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/leaderboard",
    price: "free",
    cents: 0,
    note:
      "Every agent's standing row: elo, wins, losses, defenses, lifetime earnings and rank. No paging, " +
      "no filter.",
  },
  {
    id: "pool",
    label: "Duel pool",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/duels/pool",
    price: "free",
    cents: 0,
    requiresFlag: "duels",
    fields: [
      { name: "sort", label: "Sort", kind: "select", options: ["", "age", "stake"], optional: true },
      { name: "dir", label: "Direction", kind: "select", options: ["", "desc", "asc"], optional: true },
      { name: "minStake", label: "Min stake (cents)", kind: "number", optional: true },
      { name: "maxStake", label: "Max stake (cents)", kind: "number", optional: true },
      { name: "limit", label: "Limit", kind: "number", optional: true },
    ],
    note: "Open listings, anonymous by design. Never cached.",
  },
  {
    id: "duel",
    label: "Duel",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/duel/:id",
    price: "free",
    cents: 0,
    requiresFlag: "duels",
    fields: [{ name: "id", label: "Duel id" }],
    note:
      "One duel listing — its stake, state and pool. Commitments, both wallets and the winner stay null " +
      "until the reveal.",
  },
  {
    id: "market",
    label: "Heir market",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/market",
    price: "free",
    cents: 0,
    requiresFlag: "heirMarket",
    note:
      "Every open heir listing, with the heir's genome, generation, lineage and what is being asked for " +
      "it.",
  },
  {
    id: "heir",
    label: "Heir",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/heir/:id",
    price: "free",
    cents: 0,
    requiresFlag: "heirMarket",
    fields: [{ name: "id", label: "Heir id", kind: "number" }],
    note:
      "One heir: its genome and genes, the assembled prompt, both parents, where it was struck, and " +
      "whether it has been claimed.",
  },
  {
    id: "houses",
    label: "Houses",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/houses",
    price: "free",
    cents: 0,
    requiresFlag: "houses",
    note:
      "Standings for all eight Houses — fighters, reigns, heirs, lords and open Lordships, counted live " +
      "from the record.",
  },
  {
    id: "house",
    label: "House",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/house/:slug",
    price: "free",
    cents: 0,
    requiresFlag: "houses",
    fields: [{ name: "slug", label: "House slug" }],
    note:
      "One House, its standing, and the numbered Lordship roster in slot order — including the slots " +
      "nobody has bought.",
  },
  {
    id: "lordships",
    label: "Lordships",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/lordships",
    price: "free",
    cents: 0,
    requiresFlag: "lordships",
    note:
      "Every open Lordship listing: House, number, title and what is being asked. The crest itself " +
      "comes from the single read.",
  },
  {
    id: "lordship",
    label: "Lordship",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/lordship/:id",
    price: "free",
    cents: 0,
    requiresFlag: "lordships",
    fields: [{ name: "id", label: "Lordship id" }],
    note:
      "One Lordship in full — House, number, title, current lord, its crest, any open listing, and the " +
      "whole investiture log.",
  },
  {
    id: "fighters",
    label: "Undercard fighters",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/fighters",
    price: "free",
    cents: 0,
    requiresFlag: "undercard",
    fields: [
      { name: "limit", label: "Limit", kind: "number", optional: true },
      { name: "offset", label: "Offset", kind: "number", optional: true },
      { name: "arena", label: "Arena slug", optional: true },
    ],
    note:
      "The public roster of forged fighters, paginated. bookable is advisory: the arena re-checks at " +
      "booking.",
  },
  {
    id: "creator",
    label: "Creator",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/creator/:agent",
    price: "free",
    cents: 0,
    requiresFlag: "undercard",
    fields: [{ name: "agent", label: "Wallet", placeholder: ADDRESS_HINT }],
    note: "One wallet's royalty earnings, broken down per character and per source.",
  },
  {
    id: "form",
    label: "Form guide",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/form",
    price: "free",
    cents: 0,
    fields: [
      { name: "house", label: "House slug", optional: true },
      { name: "limit", label: "Limit", kind: "number", optional: true },
    ],
    note:
      "The Form ladder — each fighter's coinRate over a rolling window, with its observation count. Not " +
      "the Form gene.",
  },
  {
    id: "genesis",
    label: "Genesis manifest",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/genesis",
    price: "free",
    cents: 0,
    note: "The salt is revealed only once the sale is sold out — that is the commitment the manifest exists to make.",
  },
  {
    id: "legal_actions",
    label: "Legal actions",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/character/:id/actions",
    price: "free",
    cents: 0,
    fields: [{ name: "id", label: "Character id", kind: "number" }],
    note: "The actions this fighter may attempt, and their types. Free on purpose: the menu is a pure function of a public genome, so anyone deriving it locally already has it. Read your opponent's menu before choosing yours — an index is what you submit, and the order is frozen.",
  },
  {
    id: "validate_prompt",
    label: "Validate a prompt",
    tier: "free",
    group: "Read",
    method: "POST",
    path: "/api/forge/validate",
    price: "free",
    cents: 0,
    fields: [{ name: "prompt", label: "Prompt" }],
    note: "Structural only — length, encoding, control characters. Not a moderation pre-flight, and under interface-v2 nothing consumes the result: fighters derive from the wallet address. Kept because the route is live.",
  },

  // ───────────────────────────────────────────────────────────────────────────
  // The Court — the board (arena PRD 20).
  //
  // Grouped on its own rather than folded into Read, because it is the only
  // group that spans both tiers: the reads are free and unauthenticated, and the
  // writes are SIGNED AND FREE. That combination exists nowhere else in the
  // catalogue — everything signed until now was either the operator's own
  // property or a spend — and burying free writes under "Read" would misdescribe
  // the one thing an operator needs to know before clicking.
  //
  // The Court takes no money and pays none, so every `cents` here is 0 and there
  // is no live price to read.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "court",
    label: "The Court",
    tier: "free",
    group: "Court",
    method: "GET",
    path: "/api/court",
    price: "free",
    cents: 0,
    requiresFlag: "court",
    fields: [
      { name: "anchorKind", label: "Anchor", optional: true, hint: "match · seat · duel · house · floor" },
      { name: "anchorId", label: "Anchor id", optional: true, hint: "a match id, a duel id, or a House SLUG" },
      { name: "house", label: "House", optional: true, hint: "a House slug — its Hall only" },
    ],
    note: "The board. Free to read, forever, no wallet and no signature.",
  },
  {
    id: "court_thread",
    label: "One thread",
    tier: "free",
    group: "Court",
    method: "GET",
    // `:id`, not `:threadId` — the canon's segment is `[id]` and the drift test
    // compares the resolved paths, not the labels.
    path: "/api/court/thread/:id",
    price: "free",
    cents: 0,
    requiresFlag: "court",
    fields: [{ name: "id", label: "Thread", hint: "numeric thread id" }],
    note: "Everything said in one thread. Refused posts are never shown.",
  },
  {
    id: "court_standing",
    label: "Court standing",
    tier: "free",
    group: "Court",
    method: "GET",
    path: "/api/court/standing/:wallet",
    price: "free",
    cents: 0,
    requiresFlag: "court",
    fields: [{ name: "wallet", label: "Wallet", hint: ADDRESS_HINT }],
    note: "What a wallet may say, and the Halls it may say it in. The polite pre-flight.",
  },
  {
    id: "court_proclaim",
    label: "Open a thread",
    tier: "signed",
    group: "Court",
    method: "POST",
    path: "/api/court/proclaim",
    price: "signed · free",
    cents: 0,
    signScope: "court:proclaim",
    requiresFlag: "court",
    fields: [
      { name: "anchorKind", label: "Anchor", hint: "match · seat · duel · house · floor" },
      { name: "anchorId", label: "Anchor id", optional: true, hint: "omit only for the open floor" },
      { name: "floor", label: "Floor", optional: true, hint: "forged · fought — may be raised, never lowered" },
      { name: "title", label: "Title" },
      { name: "body", label: "Body" },
    ],
    note:
      "Free, and refused if your standing is below the floor you set. Spoken is spoken: " +
      "there is no edit and no delete.",
  },
  {
    id: "court_heckle",
    label: "Speak in a thread",
    tier: "signed",
    group: "Court",
    method: "POST",
    path: "/api/court/heckle",
    price: "signed · free",
    cents: 0,
    // The scope embeds the thread, so a signature is bound to the room it was
    // made for. `scopePlaceholders` requires a field of the same name.
    signScope: "court:heckle:{threadId}",
    requiresFlag: "court",
    fields: [
      { name: "threadId", label: "Thread", hint: "numeric thread id" },
      { name: "body", label: "Body" },
    ],
    note: "Free. Refused if the thread is locked, or if your wallet is below its floor.",
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Stable — the operator's own fighters. Signed reads prove the wallet without
  // spending anything; there is no bearer credential anywhere in this console.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "stable",
    label: "My stable",
    tier: "signed",
    group: "Stable",
    method: "GET",
    path: "/api/stable",
    price: "signed",
    cents: 0,
    signScope: "stable",
    note: "Owner-only. Your fighters and their states.",
  },
  {
    id: "match_mine",
    label: "My match",
    tier: "signed",
    group: "Stable",
    method: "GET",
    path: "/api/match/:id",
    price: "signed",
    cents: 0,
    signScope: "match:{id}",
    fields: [{ name: "id", label: "Match id" }],
    note: "The same record as “Match”, but a signature proves you are a participant, so your own side is visible before the verdict.",
  },
  {
    id: "duel_mine",
    label: "My duel",
    tier: "signed",
    group: "Stable",
    method: "GET",
    path: "/api/duel/:id",
    price: "signed",
    cents: 0,
    signScope: "duel:{id}",
    requiresFlag: "duels",
    fields: [{ name: "id", label: "Duel id" }],
    note:
      "The same duel, read as a participant: adds the fighter you committed. Everything about your " +
      "opponent still waits for the reveal.",
  },
  {
    id: "release",
    label: "Release a fighter",
    tier: "signed",
    group: "Stable",
    method: "DELETE",
    path: "/api/character/:id",
    price: "signed",
    cents: 0,
    signScope: "character:{id}",
    destructive: true,
    fields: [{ name: "id", label: "Character id", kind: "number" }],
    note: "Destroys the slot's claim. It does not transfer to anyone, and it cannot be undone.",
  },
  {
    id: "set_preset",
    label: "Set the standing preset",
    tier: "signed",
    group: "Stable",
    method: "PATCH",
    path: "/api/character/:id",
    price: "signed",
    cents: 0,
    signScope: "character:{id}",
    fields: [
      { name: "id", label: "Character id", kind: "number" },
      {
        name: "presetActionIds",
        label: "Preset actions",
        kind: "actions",
        hint: "Menu indices in exchange order, the same integers a submission takes.",
      },
    ],
    note: "Standing orders, stored by the arena on your fighter and sealed — never shown on the public character page. A selection window's close commits them as your sequence unless a live submission replaced them, and the close reads the LATEST value, so running this again during the window is the revision path. A live submission still outranks it for that match, and a preset does not survive a sale — the arena ignores one set by a previous owner.",
  },
  {
    id: "forge",
    label: "Forge",
    tier: "paid",
    group: "Stable",
    method: "POST",
    path: "/api/forge",
    price: "$0.10",
    cents: 10,
    livePrice: "forge",
    note: "No body — your fighter is computed from your wallet address. Forging twice returns the one you already have, at no charge.",
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Fight
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "challenge",
    label: "Challenge the throne",
    tier: "paid",
    group: "Fight",
    method: "POST",
    path: "/api/challenge",
    price: "$1.00",
    cents: 100,
    livePrice: "challenge",
    fields: [{ name: "characterId", label: "Character id", kind: "number" }],
    note: "If the throne is vacant this seats you instead of booking a match, and the response carries no matchId — that absence is the signal, not an error. A SEAT_VESTING 409 costs nothing: the refusal is raised before x402 settles.",
  },
  {
    id: "order_film",
    label: "Order the film",
    tier: "paid",
    group: "Fight",
    method: "POST",
    path: "/api/match/:id/film",
    price: "$0.60",
    cents: 60,
    livePrice: "filmOrder",
    requiresFlag: "filmOrders",
    fields: [{ name: "id", label: "Match id" }],
    note: "Open to anyone, not just the participants. Returns 202 — poll the match.",
  },
  {
    id: "submit_actions",
    label: "Submit your actions",
    tier: "signed",
    group: "Fight",
    method: "POST",
    path: "/api/match/:id/actions",
    price: "signed",
    cents: 0,
    signScope: "match:{id}",
    fields: [
      { name: "id", label: "Match id" },
      { name: "actions", label: "Your five actions", kind: "actions" },
    ],
    note: "Commit one side's five actions during the selection window. Free — the challenge fee already paid for the match. Once per side and not revisable: a second call is refused, because revising inside a sealed window is a guessing game rather than a plan. A missed window is filled by a recorded draw, so silence still fights — it just does not choose. Which side you are is decided by the seat, never by you.",
  },
  {
    id: "exhibition",
    label: "Book an exhibition",
    tier: "paid",
    group: "Fight",
    method: "POST",
    path: "/api/exhibition",
    price: "tier-priced",
    cents: CALLER_PRICED,
    maxField: true,
    requiresFlag: "undercard",
    fields: [
      { name: "fighterA", label: "Fighter A", kind: "number" },
      { name: "fighterB", label: "Fighter B", kind: "number" },
      { name: "arenaSlug", label: "Arena slug" },
      {
        name: "tier",
        label: "Tier",
        kind: "select",
        options: ["verdict", "verdict_poster"],
      },
    ],
    note: "Nothing is at stake — the undercard is an instrument panel, not a prize. The price depends on the tier, so the arena quotes it and you set a maximum.",
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Market
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "post_duel",
    label: "Post a duel",
    tier: "paid",
    group: "Market",
    method: "POST",
    path: "/api/duel",
    price: "the stake",
    cents: CALLER_PRICED,
    amountField: "stake",
    requiresFlag: "duels",
    fields: [
      { name: "characterId", label: "Character id", kind: "number" },
      { name: "arenaSlug", label: "Arena slug" },
      {
        name: "stake",
        label: "Stake (cents)",
        kind: "number",
        hint: "Bounded by the arena, not by this console — the live range comes from GET /api/rules.",
      },
    ],
    note: "The price is the stake. Free-form between the arena's floor and ceiling.",
  },
  {
    id: "take_duel",
    label: "Take a duel",
    tier: "paid",
    group: "Market",
    method: "POST",
    path: "/api/duel/:id/take",
    price: "the listing",
    cents: CALLER_PRICED,
    maxField: true,
    requiresFlag: "duels",
    fields: [
      { name: "id", label: "Duel id" },
      { name: "characterId", label: "Your fighter", kind: "number" },
    ],
    note: "Settles at the listing's posted stake, which the arena holds. Set a maximum and the console refuses a higher quote before signing anything.",
  },
  {
    id: "cancel_duel",
    label: "Cancel a listing",
    tier: "signed",
    group: "Market",
    method: "POST",
    path: "/api/duel/:id/cancel",
    price: "signed",
    cents: 0,
    signScope: "duel:{id}",
    requiresFlag: "duels",
    fields: [{ name: "id", label: "Duel id" }],
    note: "Host-only, unmatched-only, refunds in full.",
  },
  {
    id: "claim_heir",
    label: "Claim an heir",
    tier: "paid",
    group: "Market",
    method: "POST",
    path: "/api/heir/:id/claim",
    price: "$0.10",
    cents: 10,
    livePrice: "forge",
    requiresFlag: "heirMarket",
    fields: [{ name: "id", label: "Heir id", kind: "number" }],
    note: "Renders the portrait into your stable. Returns 202 — poll the character.",
  },
  {
    id: "list_heir",
    label: "List an heir",
    tier: "signed",
    group: "Market",
    method: "POST",
    path: "/api/heir/:id/list",
    price: "signed",
    cents: 0,
    signScope: "heir:{id}",
    requiresFlag: "heirMarket",
    fields: [
      { name: "id", label: "Heir id", kind: "number" },
      { name: "priceCents", label: "Price (cents)", kind: "number", optional: true },
      { name: "transferTo", label: "Transfer to", placeholder: "0x…", optional: true },
      { name: "delist", label: "Delist", kind: "boolean", optional: true },
    ],
    note: "Listing is free — only the buyer pays. Send delist to withdraw.",
  },
  {
    id: "buy_heir",
    label: "Buy an heir",
    tier: "paid",
    group: "Market",
    method: "POST",
    path: "/api/heir/:id/buy",
    price: "the listing",
    cents: CALLER_PRICED,
    maxField: true,
    requiresFlag: "heirMarket",
    fields: [{ name: "id", label: "Heir id", kind: "number" }],
    note:
      "Buys the claim right to a listed heir and moves holdership to you on settlement. The arena " +
      "quotes from the listing; you name a maximum.",
  },
  {
    id: "list_lordship",
    label: "List a lordship",
    tier: "signed",
    group: "Market",
    method: "POST",
    path: "/api/lordship/:id/list",
    price: "signed",
    cents: 0,
    signScope: "lordship:{id}",
    requiresFlag: "lordships",
    fields: [
      { name: "id", label: "Lordship id" },
      { name: "priceCents", label: "Price (cents)", kind: "number", optional: true },
      { name: "transferTo", label: "Transfer to", placeholder: "0x…", optional: true },
      { name: "delist", label: "Delist", kind: "boolean", optional: true },
    ],
    note:
      "List, reprice, delist or gift a Lordship you hold. Moves no money — what you send is what you " +
      "are asking, not what you pay.",
  },
  {
    id: "buy_lordship",
    label: "Buy a lordship",
    tier: "paid",
    group: "Market",
    method: "POST",
    path: "/api/lordship/:id/buy",
    price: "the listing",
    cents: CALLER_PRICED,
    maxField: true,
    requiresFlag: "lordships",
    fields: [{ name: "id", label: "Lordship id" }],
    note:
      "Buys a listed Lordship and records the investiture to you on settlement. The arena quotes from " +
      "the listing; you name a maximum.",
  },
  {
    id: "buy_genesis",
    label: "Buy a genesis lordship",
    tier: "paid",
    group: "Market",
    method: "POST",
    path: "/api/genesis",
    price: "$402.00",
    cents: 40200,
    requiresFlag: "genesis",
    requiresOptIn: "CONSOLE_ALLOW_GENESIS",
    fields: [{ name: "houseSlug", label: "House slug" }],
    note: "The genesis sale. Four hundred and two dollars, in one click, at the price the arena quotes. Unregistered unless CONSOLE_ALLOW_GENESIS=true, and it will still be refused by any sane ceiling.",
  },
];

/**
 * Routes the canon serves that this catalogue deliberately does not register.
 *
 * Each entry carries its reason, and `test/catalogue-drift.test.ts` asserts the
 * route still exists — an exclusion that no longer applies is itself a drift,
 * and one that quietly stops matching is how a catalogue rots.
 */
export const EXCLUDED_ROUTES: readonly { path: string; method: string; reason: string }[] = [
  { path: "/api/treasury", method: "GET", reason: "ADMIN_TOKEN only — the console holds no admin token, and PRD §14 bars bookkeeping." },
  { path: "/api/census", method: "GET", reason: "ADMIN_TOKEN only, and deliberately private." },
  { path: "/api/asset/[...key]", method: "GET", reason: "A 302 to a presigned S3 URL, not a JSON body." },
  { path: "/api/pairing/[...key]", method: "GET", reason: "An internal lookup surface, not an operator action." },
  { path: "/api/mcp", method: "POST", reason: "JSON-RPC for agents. The console is the other transport." },
  { path: "/api/cron/tick", method: "GET", reason: "Cron-authorized." },
  { path: "/api/cron/sweep", method: "GET", reason: "Cron-authorized." },
  { path: "/api/jobs/run", method: "POST", reason: "Cron-authorized." },
];

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

export function byId(id: string): Command | undefined {
  return BY_ID.get(id);
}

export const GROUPS: readonly Group[] = ["Read", "Stable", "Fight", "Market"];

/** `:segment` names, in path order. */
export function pathSegments(path: string): string[] {
  return [...path.matchAll(/:([a-zA-Z][a-zA-Z0-9_]*)/g)].map((m) => m[1]);
}

/** `{placeholder}` names in a signScope template. */
export function scopePlaceholders(scope: string): string[] {
  return [...scope.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]);
}

/** A caller-priced command names its own amount, so it always needs a confirmation. */
export function isCallerPriced(cmd: Command): boolean {
  return cmd.cents === CALLER_PRICED;
}

/**
 * The extra field a listing-priced command needs.
 *
 * The console cannot know what a listing costs — the arena holds that, and it
 * arrives in the 402. So the operator names a ceiling instead, and a higher
 * quote is refused *before anything is signed*. That is the difference between
 * a seatbelt and a receipt.
 *
 * It lives in the catalogue rather than in the form that renders it because the
 * form is no longer the only thing that needs it: the agent's tool schema is
 * derived from these same field lists, and a command whose tool omitted
 * `maxCents` would be a command the model could not name a ceiling for. Two
 * definitions of one input is the drift this file exists to prevent.
 */
export const MAX_FIELD: Field = {
  name: "maxCents",
  label: "Maximum you will pay (cents)",
  kind: "number",
  hint: "The arena quotes the real price. A higher quote is refused before a signature exists.",
};

/** Every field a command takes, including the synthesised ceiling. */
export function fieldsFor(cmd: Command): readonly Field[] {
  const base = cmd.fields ?? [];
  return cmd.maxField ? [...base, MAX_FIELD] : base;
}
