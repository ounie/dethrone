import "server-only";
import * as arena from "./arena";
import { INTERFACE_VERSION } from "./interface";
import type { FeatureFlag } from "./commands";

/**
 * The boot probe of `GET /api/rules`.
 *
 * ## Why this is the whole point of publishing rules
 *
 * The console must not hard-code an answer the server owns. It does not know
 * what a forge costs, whether duels are open, or what the stake range is — it
 * asks, once, and renders whatever came back. A catalogue that hard-codes any
 * of that is a rule living in a transport, and on the day the server changes,
 * the transport is confidently wrong.
 *
 * ## The one thing that IS pinned, and why it is the version and not a rule
 *
 * The PRD asks this probe to choose between two forge shapes — a prompt behind
 * a participant token, or a fighter derived from the payer's address. That
 * branch cannot be implemented against the live canon and it should not be
 * faked: `interface-v2` deleted the prompt route entirely, `POST /api/forge`
 * refuses a body, and `/api/rules` publishes no field that describes which
 * shape is live. There is nothing to branch on.
 *
 * So the branch moves one level up, where it generalises. The console pins the
 * **interface version** it was written against. On a mismatch it disables every
 * paid command and leaves every free read working — it fails closed on money
 * and open on reads, which is the only direction that is safe in both. That
 * covers the forge question and every future one like it, instead of one
 * question that has already been answered.
 */

export interface Rules {
  reachable: boolean;
  interfaceVersion: string | null;
  interfaceMatches: boolean;
  /** Live prices in cents, keyed as the catalogue's `livePrice` names them. */
  money: Partial<Record<"forge" | "challenge" | "filmOrder", number>>;
  /** The canon's own sentence about forging, rendered verbatim where present. */
  forgeNote: string | null;
  /**
   * The stake bounds, and the arena's own sentence about what it takes.
   *
   * `note` is published prose about the rake, rendered verbatim: this console
   * does not restate a money rule in words of its own any more than it computes
   * one in arithmetic.
   */
  duel: {
    enabled: boolean;
    minStakeCents: number | null;
    maxStakeCents: number | null;
    note: string | null;
  };
  /**
   * The actions layer's shape, as the canon publishes it.
   *
   * Read rather than typed, for the reason everything else here is read: five
   * is a RULE. A console that hard-coded five slots would be a second
   * implementation of `actions-v1`, correct today and wrong the version it
   * changes — and wrong in the worst direction, because a form that silently
   * offers the old count produces a request the arena refuses after the
   * operator has done the work.
   *
   * Null when the canon publishes nothing, and the caller must then impose no
   * limit at all rather than fall back to a number. A guessed cap is the same
   * mistake with a friendlier face; an uncapped list is honest and the arena
   * still refuses the rest.
   */
  actions: { sequenceLength: number | null; menuSize: number | null };
  /**
   * The Rail, as the canon publishes it.
   *
   * `enabled` decides whether a market command is offered at all — the nav rule
   * again. `minPositionCents` exists because a position is CALLER-PRICED: the
   * amount you pay is your stake, so there is no 402 to read a price off, and a
   * card arming that field would otherwise be picking a number for the operator.
   * Null where the canon published none, and the caller must then leave the
   * field blank rather than invent one.
   */
  rail: {
    enabled: boolean;
    minPositionCents: number | null;
    rakeBps: number | null;
    note: string | null;
  };
  /**
   * The Founding Purse's tiers, straight from the canon.
   *
   * Published because a form cannot be built without them: the pledge command
   * picks a tier and then asks for a ceiling, and both the price it shows and
   * the ceiling it suggests have to be the arena's numbers. Typing five prices
   * into `commands.ts` would be a second copy of arena data — the thing
   * `DUEL_STAKE_PRESET_CENTS` gets away with only because presets are a
   * suggestion filtered against the live range, and a price is not a suggestion.
   *
   * `priceMicro` is integer micro-USDC as a string, because the entry tier is
   * sub-cent and has no whole-cent form. Empty when the canon publishes nothing,
   * and a caller must then show no price and suggest no ceiling rather than
   * inventing either.
   */
  patronage: {
    key: string;
    name: string;
    priceMicro: string;
    priceLabel: string;
    cap: number | null;
  }[];
  /** Feature flags the console can infer from published fields alone. */
  features: Partial<Record<FeatureFlag, boolean>>;
  arena: { slug: string; displayName: string } | null;
  fetchedAt: number;
}

const TTL_MS = 30_000;

interface Cache {
  value: Rules;
  at: number;
}

const GLOBAL_KEY = "__dethrone_console_rules__";

function cache(): { current?: Cache } {
  const g = globalThis as unknown as Record<string, { current?: Cache } | undefined>;
  return (g[GLOBAL_KEY] ??= {});
}

const UNREACHABLE: Rules = {
  reachable: false,
  interfaceVersion: null,
  interfaceMatches: true,
  money: {},
  forgeNote: null,
  duel: { enabled: false, minStakeCents: null, maxStakeCents: null, note: null },
  actions: { sequenceLength: null, menuSize: null },
  rail: { enabled: false, minPositionCents: null, rakeBps: null, note: null },
  patronage: [],
  features: {},
  arena: null,
  fetchedAt: 0,
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function shape(body: unknown, interfaceVersion: string | null): Rules {
  const b = (body ?? {}) as Record<string, unknown>;
  const money = (b.money ?? {}) as Record<string, { cents?: unknown }>;
  const forge = (b.forge ?? {}) as Record<string, unknown>;
  const duel = (b.duel ?? {}) as Record<string, unknown>;
  const actions = (b.actions ?? {}) as Record<string, unknown>;
  const patronage = (b.patronage ?? {}) as Record<string, unknown>;
  const rail = (b.rail ?? {}) as Record<string, unknown>;

  const duelEnabled = duel.enabled === true;
  const railEnabled = rail.enabled === true;

  return {
    reachable: true,
    interfaceVersion,
    interfaceMatches: interfaceVersion === null || interfaceVersion === INTERFACE_VERSION,
    money: {
      ...(num(money.forge?.cents) !== null ? { forge: money.forge!.cents as number } : {}),
      ...(num(money.challenge?.cents) !== null ? { challenge: money.challenge!.cents as number } : {}),
      ...(num(money.filmOrder?.cents) !== null ? { filmOrder: money.filmOrder!.cents as number } : {}),
    },
    forgeNote: typeof forge.note === "string" ? forge.note : null,
    duel: {
      enabled: duelEnabled,
      minStakeCents: num(duel.minStakeCents),
        maxStakeCents: num(duel.maxStakeCents),
      note: typeof duel.note === "string" && duel.note ? duel.note : null,
    },
    actions: {
      sequenceLength: num(actions.sequenceLength),
      menuSize: num(actions.menuSize),
    },
    rail: {
      // Absent is OFF. An arena that predates the block publishes nothing, and
      // offering a market command against it would be the nav-item-that-404s
      // failure — the same reading `duelEnabled` takes one field up.
      enabled: railEnabled,
      minPositionCents: num(rail.minPositionCents),
      rakeBps: num(rail.rakeBps),
      note: typeof rail.note === "string" && rail.note ? rail.note : null,
    },
    /*
      Each row validated individually and dropped if it is not whole, rather
      than the block being taken or left as a unit. A tier missing its price
      would otherwise render a picker entry that shows nothing and suggests
      nothing, which reads as a broken form rather than as an absent number.

      `priceMicro` is kept as the STRING the canon sent. Parsing it to a JS
      number here would put money through a double for no reason — the only
      thing this console does with it is show it and derive a ceiling, and both
      are done from the string in `lib/patronage.ts`.
    */
    patronage: (Array.isArray(patronage.tiers) ? patronage.tiers : [])
      .map((row) => row as Record<string, unknown>)
      .filter(
        (row) =>
          typeof row.key === "string" &&
          typeof row.name === "string" &&
          typeof row.priceLabel === "string" &&
          typeof row.priceMicro === "string" &&
          /^\d+$/.test(row.priceMicro),
      )
      .map((row) => ({
        key: row.key as string,
        name: row.name as string,
        priceMicro: row.priceMicro as string,
        priceLabel: row.priceLabel as string,
        cap: num(row.cap),
      })),
    // `duels` and `rail` are published directly; the rest are discovered the
    // honest way — a 404 that carries the interface header — rather than guessed
    // at here, because a guess would be the console deciding a rule.
    //
    // The Rail's flag matters more than most: with it off every one of its
    // routes 404s, and a market command offered against that is the nav item
    // that 404s. House Cards themselves are NOT gated on it — the house books
    // those whether or not anybody can back a fighter.
    features: { duels: duelEnabled, rail: railEnabled },
    arena:
      typeof (b.arena as { slug?: unknown } | undefined)?.slug === "string"
        ? {
            slug: (b.arena as { slug: string }).slug,
            displayName: String((b.arena as { displayName?: unknown }).displayName ?? ""),
          }
        : null,
    fetchedAt: Date.now(),
  };
}

export async function rules(): Promise<Rules> {
  const c = cache();
  if (c.current && Date.now() - c.current.at < TTL_MS) return c.current.value;

  const outcome = await arena.call({ method: "GET", path: "/api/rules", paid: false });
  if (!outcome.result || !outcome.result.ok) {
    // A stale-but-real answer beats an empty one; an empty one beats a wrong one.
    return c.current?.value ?? UNREACHABLE;
  }

  const value = shape(outcome.result.body, outcome.result.interfaceVersion);
  c.current = { value, at: Date.now() };
  return value;
}
