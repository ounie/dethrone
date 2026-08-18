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

/**
 * One-tap stake amounts for a duel, in cents.
 *
 * They live HERE because this is the only file under `src/` permitted a
 * currency literal, and `command-pane.tsx` — which renders them — is not. That
 * is not a technicality to route around: the rule exists so that every number
 * a browser shows can be traced to one place, and a hand-typed array of amounts
 * in a component is precisely the thing it forbids.
 *
 * **A convenience, never a constraint.** The stake field stays free-form,
 * because the arena accepts any amount between its floor and its ceiling and a
 * preset that narrowed that would be this console holding a rule it does not
 * own. They are also FILTERED at render against the live range from
 * `GET /api/rules`, so a deploy with a tighter band never offers a button that
 * would be refused — the canon bounds them, this list only suggests.
 */
export const DUEL_STAKE_PRESET_CENTS: readonly number[] = [100, 500, 1000, 5000];

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
/**
 * `arena` is a select whose OPTIONS COME FROM THE ARENA, not from this file.
 *
 * The eight are the canon's list and it changes without this console being
 * redeployed — a hard-coded enumeration here would be a second copy of game
 * data, wrong the day one is retired or a ninth is chartered. The catalogue
 * declares that a field NAMES an arena; `GET /api/arenas` says which ones
 * exist; `command-pane.tsx` renders what it was handed, and falls back to a
 * free-text box when it was handed nothing.
 */
/**
 * `patronTier` is `arena`'s sibling: a select whose OPTIONS ARE NAMED here but
 * whose PRICES come from the canon.
 *
 * The distinction is the console's second rule. Naming the five tiers is not a
 * game rule — they are a stable vocabulary, and the static `options` below are
 * a fine fallback when the rules read fails, exactly as `arena` falls back to a
 * text box. PRICING them is a rule, and five amounts typed into this file would
 * be a second copy of arena data that goes wrong silently the day one moves.
 *
 * So `GET /api/rules` publishes a `patronage` block, the pane renders the price
 * beside each option, and selecting one fills the ceiling from that number.
 * With the read unavailable the select still works and simply shows no price —
 * which is the honest state, and leaves the arena to quote in the 402.
 */
export type FieldKind =
  | "text"
  | "number"
  | "select"
  | "boolean"
  | "actions"
  | "arena"
  | "patronTier";

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

/**
 * The explicit opt-ins. Each is an env var name, and the name IS the key —
 * `capabilityFor` looks this literal up in a set built from the environment, so
 * the mapping cannot drift the way a parallel boolean field did.
 */
export const OPT_INS = ["CONSOLE_ALLOW_GENESIS", "CONSOLE_ALLOW_PATRONAGE"] as const;
export type OptIn = (typeof OPT_INS)[number];

/**
 * ⚠️ **Vestigial.** Nothing reads `Command.group`, and `GROUPS` below has one
 * consumer: a dead import in `rail.tsx`. The rail sections by `tier` — Free
 * reads / Signed / Paid writes — on the argument stated at the top of that
 * file, that cost is the only access control in the system and so the left
 * column IS the permission model, rendered.
 *
 * It is kept, and kept accurate, because it is the obvious hook if sub-headers
 * are ever wanted inside the cost sections. Do NOT reach for it expecting a
 * section to appear: `"Court"` has been declared on three commands since the
 * board shipped and has never rendered anywhere.
 */
export type Group = "Read" | "Stable" | "Fight" | "Market" | "Court" | "Patronage";

/** Kill switches the canon exposes. A flagged route 404s when its feature is off. */
export type FeatureFlag =
  | "duels"
  | "rail"
  | "heirMarket"
  | "lordships"
  | "houses"
  | "undercard"
  | "filmOrders"
  | "genesis"
  | "court"
  | "patronage";

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
   * Caller-priced commands whose price the *server* holds (a listing, a
   * patronage tier). The operator names a maximum instead; the 402's offer is
   * refused above it, before anything is signed.
   */
  maxField?: boolean;
  requiresFlag?: FeatureFlag;
  /**
   * Requires an explicit opt-in env var to appear at all.
   *
   * ⚠️ This was a union of ONE value, checked against a hardcoded
   * `cfg.allowGenesis` boolean. A second entry would therefore have been
   * enabled by `CONSOLE_ALLOW_GENESIS` — a deploy that opted in to selling one
   * $402 title would silently have opted in to a $40,200 pledge as well. The
   * check now reads a SET keyed by this literal, so each opt-in enables exactly
   * itself and adding a third is a type error until it is wired.
   */
  requiresOptIn?: OptIn;
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
      {
        name: "mode",
        label: "Lane",
        kind: "select",
        options: ["", "throne", "duel", "undercard", "all"],
        optional: true,
        hint: "Empty is throne only, which is what this route returned before it learned the others.",
      },
      { name: "limit", label: "Limit", kind: "number", optional: true },
    ],
    note:
      "Matches newest first, with both fighters, the arena, the tally and the outcome. Empty lane " +
      "means throne only; ask for duel, undercard or all by name. Filter with status.",
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
    id: "cards",
    label: "House Cards",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/cards",
    price: "free",
    cents: 0,
    fields: [
      {
        name: "status",
        label: "Scope",
        kind: "select",
        options: ["", "all"],
        optional: true,
        hint: "Empty is bells still ahead, soonest first. `all` is every public status, newest first.",
      },
      { name: "limit", label: "Limit", kind: "number", optional: true },
    ],
    note:
      "The house's own demonstrations: both fighters, their Houses and records, the bell, and the " +
      "market on the card if it carries one. Drafted and cancelled cards are not published.",
  },
  {
    id: "card",
    label: "House Card",
    tier: "free",
    group: "Read",
    method: "GET",
    path: "/api/cards/:id",
    price: "free",
    cents: 0,
    fields: [{ name: "id", label: "Card id" }],
    note: "One card, in the same shape a row of the list has.",
  },
  {
    id: "rail",
    label: "The Rail",
    tier: "free",
    group: "Market",
    method: "GET",
    path: "/api/rail",
    requiresFlag: "rail",
    price: "free",
    cents: 0,
    note:
      "Open markets on House Cards — pools, implied prices, open interest. The sides are named by " +
      "House Cards, which carries the same market on the card it belongs to. Answers " +
      "`enabled: false` with an empty list when the Rail is closed, never a 404.",
  },
  {
    id: "rail_market",
    label: "Rail market",
    tier: "free",
    group: "Market",
    method: "GET",
    path: "/api/rail/:id",
    requiresFlag: "rail",
    price: "free",
    cents: 0,
    fields: [{ name: "id", label: "Market id" }],
    note: "One market, its terms, and the x402 command that takes a position on it.",
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
    id: "duels_mine",
    label: "My duels",
    tier: "signed",
    group: "Stable",
    method: "GET",
    path: "/api/duels/mine",
    price: "signed",
    cents: 0,
    signScope: "duels:mine",
    requiresFlag: "duels",
    note:
      "Every duel you host or took, newest first, with the ones still waiting on somebody marked. " +
      "The pool is anonymous by design, so this is the only read that answers what you are in.",
  },
  {
    id: "duel_invitations",
    label: "Challenges to me",
    tier: "signed",
    group: "Stable",
    method: "GET",
    path: "/api/duel/invitations",
    price: "signed",
    cents: 0,
    signScope: "duel:invitations",
    requiresFlag: "duels",
    note:
      "Open challenges addressed to your wallet, with every term: the stake, the arena, whether " +
      "the duel is unlisted, and the hour it is appointed for. Nothing notifies you — this read is " +
      "the whole of the inbox, so poll it. An invitation expires on its own clock whatever hour it " +
      "names, and refunds its sender in full.",
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
    note: "This carries the fighter id and nothing else — a plan built in the Fighters panel is NOT part of what you pay for here. Selection happens later: either you submit during the window at pairing, or the fighter's standing preset is committed at the close. Set that preset before or after paying; it is free and revisable until the window shuts. If the throne is vacant this seats you instead of booking a match, and the response carries no matchId — that absence is the signal, not an error. A SEAT_VESTING 409 costs nothing: the refusal is raised before x402 settles.",
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
      { name: "arenaSlug", label: "Arena", kind: "arena" },
      {
        name: "stake",
        label: "Stake (cents)",
        kind: "number",
        hint: "Bounded by the arena, not by this console — the live range comes from GET /api/rules.",
      },
      {
        name: "opponent",
        label: "Rival wallet (optional)",
        hint: "Naming one makes this a challenge only that wallet can accept, instead of a listing anyone can take.",
      },
      {
        name: "visibility",
        label: "Visibility (optional)",
        hint: "unlisted keeps it out of every feed and the pool. It does not hide it: the resolved page still publishes both fighters and all five coins at its URL, and it counts in both records. Needs a rival.",
      },
      {
        name: "scheduledAt",
        label: "Appointed hour (optional)",
        hint: "ISO 8601. The verdict is enqueued at that minute — a window, not a broadcast second, because throne verdicts take the lane. Needs a rival.",
      },
    ],
    note: "The price is the stake. Free-form between the arena's floor and ceiling. It carries no plan: a listing books a fight, and your five actions arrive either as a live submission during the window or as the fighter's standing preset, which the close commits for you.",
  },
  {
    id: "accept_duel",
    label: "Accept a challenge",
    tier: "paid",
    group: "Market",
    method: "POST",
    path: "/api/duel/:id/accept",
    price: "the invitation",
    cents: CALLER_PRICED,
    maxField: true,
    requiresFlag: "duels",
    fields: [
      { name: "id", label: "Duel id" },
      { name: "characterId", label: "Your fighter", kind: "number" },
    ],
    note: "Settles at the invitation's stake, which the arena holds — there is no counter-offer, because a counter-offer is a new invitation. Accepting consents to every term at once: the stake, the visibility and the hour. After that the only exits are the refund matrix, however far off the hour is.",
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
    note: "Settles at the listing's posted stake, which the arena holds. Set a maximum and the console refuses a higher quote before signing anything. It carries no plan: your five actions arrive either as a live submission during the window or as the fighter's standing preset, which the close commits for you.",
  },
  {
    id: "take_position",
    label: "Back a fighter",
    tier: "paid",
    group: "Market",
    method: "POST",
    path: "/api/rail/:id/position",
    requiresFlag: "rail",
    price: "your stake",
    cents: CALLER_PRICED,
    maxField: true,
    fields: [
      { name: "id", label: "Market id" },
      {
        name: "outcome",
        label: "Side",
        kind: "select",
        options: ["a", "b"],
        hint: "A and B are the card's own slots — House Cards names the fighter in each.",
      },
      { name: "amountCents", label: "Stake (cents)", kind: "number" },
    ],
    note:
      "The amount you pay IS your stake — there is no quote to accept and no cash-out. Backers of the " +
      "winning side split the pool less the rake; your effective price moves until the bell. Settles on " +
      "the recomputable verdict, never on an opinion of it.",
  },
  {
    id: "my_positions",
    label: "My positions",
    tier: "signed",
    group: "Market",
    method: "GET",
    path: "/api/rail/:id/positions/:wallet",
    requiresFlag: "rail",
    price: "signed",
    cents: 0,
    signScope: "{id}",
    fields: [
      { name: "id", label: "Market id" },
      { name: "wallet", label: "Wallet", hint: ADDRESS_HINT },
    ],
    note:
      "What you hold on one market. The pools are public and who holds what is not, so this one is " +
      "signed — with the MARKET id as the scope, not a match.",
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

  // ───────────────────────────────────────────────────────────────────────────
  // The Founding Purse
  //
  // ⚠️ `group: "Patronage"` renders NOTHING — see the note on `Group`. These
  // land in the rail's cost sections like everything else: the two reads under
  // Free reads, the pledge under Paid writes. The group is metadata for a
  // sub-header that does not exist yet.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "patronage",
    label: "The Founding Purse",
    tier: "free",
    group: "Patronage",
    method: "GET",
    path: "/api/patronage",
    price: "free",
    cents: 0,
    // No `requiresFlag`. The manifest answers whether the campaign is open in
    // its own `open` field rather than 404ing, exactly as `GET /api/genesis`
    // does — so an operator can read the shape of a campaign that has not
    // started, and a gate here would hide the one surface that says so.
    note:
      "What the campaign has raised, what each tier grants, how many of the capped places are left, " +
      "and the published target model behind the goal. The raise counts confirmed pledges AND " +
      "genesis lordships, because both fund the same world.",
  },
  {
    id: "patron_scroll",
    label: "The Patron Scroll",
    tier: "free",
    group: "Patronage",
    method: "GET",
    path: "/api/patronage/scroll",
    price: "free",
    cents: 0,
    fields: [
      { name: "limit", label: "Limit", kind: "number", optional: true, hint: "1–200. Default 50." },
      { name: "offset", label: "Offset", kind: "number", optional: true, hint: "Where to start." },
    ],
    note:
      "Every confirmed pledge in settle order, with the transaction that paid for it. A pledge is " +
      "frozen once paid and there is no delete path, so an entry's number never shifts.",
  },
  {
    id: "patronage_pledge",
    label: "Pledge to the Founding Purse",
    tier: "paid",
    group: "Patronage",
    method: "POST",
    path: "/api/patronage/:tier",
    // Five fixed prices, chosen by the path segment: the arena quotes, you cap.
    price: "tier-priced",
    cents: CALLER_PRICED,
    maxField: true,
    requiresFlag: "patronage",
    /*
      Behind its own opt-in, and NOT because the top tier is expensive — though
      it is the largest single spend the arena offers.

      This console spends a wallet the HOUSE holds. A pledge from it moves the
      raise, the backer count and the lit marks on a public page that presents
      all three as outside support. A Lordship is a title somebody buys FROM us,
      so `buy_genesis` above is merely large; a pledge is a claim about who is
      behind us, and the house cannot make that claim about itself.

      Worse on a capped tier: `confirmPledge` sets `payment_id`, which freezes
      the row, so a Benefactor or Founder pledge permanently consumes one of
      twelve or four places and writes an undeletable Scroll entry.
    */
    requiresOptIn: "CONSOLE_ALLOW_PATRONAGE",
    fields: [
      {
        name: "tier",
        label: "Tier",
        kind: "patronTier",
        // Names only. The prices come from the canon's `patronage` block, and
        // these five stay as the fallback for a deploy whose rules read failed.
        options: ["coin", "torch", "herald", "benefactor", "founder"],
        hint: "Choosing a tier fills the ceiling below from the arena's own price.",
      },
    ],
    note:
      "Recognition and canon only — no credits, no balance, nothing redeemable, and no advantage in " +
      "any match. Final at settlement, with no refund path anywhere in the design. The lordship tier " +
      "is not sold here: that is Buy a genesis lordship, above.",
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
