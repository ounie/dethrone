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
  duel: { enabled: boolean; minStakeCents: number | null; maxStakeCents: number | null };
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
  duel: { enabled: false, minStakeCents: null, maxStakeCents: null },
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

  const duelEnabled = duel.enabled === true;

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
    },
    // Only `duels` is published directly. The rest are discovered the honest
    // way — a 404 that carries the interface header — rather than guessed at
    // here, because a guess would be the console deciding a rule.
    features: { duels: duelEnabled },
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
