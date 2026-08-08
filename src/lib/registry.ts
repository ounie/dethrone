import "server-only";
import type { Capabilities, Capability } from "./capability";
import { COMMANDS, type Command } from "./commands";
import { config } from "./config";
import { rules } from "./rules";
import { hasWallet } from "./wallet";

/**
 * Which commands this deploy can actually run, and why not, for the ones it
 * cannot.
 *
 * ## Why this is a module and not a function in the page
 *
 * It was a function in the page — `capability()` in `src/app/page.tsx` — and
 * that was correct while the page was the only thing that needed to know. The
 * agent is the second, and it needs the identical answer: the tool surface it
 * is handed must contain exactly the commands the rail renders as clickable,
 * or the model will reach for something this deploy cannot do and the operator
 * will read a refusal that looks like a game rule.
 *
 * Two implementations of "which commands exist here" is the same failure the
 * catalogue exists to prevent, one level up. So there is one, and both callers
 * import it.
 *
 * ## What it is still not allowed to decide
 *
 * A game rule. Every verdict here comes from something the arena published
 * (`GET /api/rules`) or from this process's own configuration (a key, a flag).
 * Nothing reads a clock and nothing infers eligibility. The single flag-based
 * refusal — duels — is the one the canon publishes directly; every other
 * feature flag is discovered the honest way, by asking and rendering the 404.
 */

export type LiveRules = Awaited<ReturnType<typeof rules>>;

export interface CapabilityContext {
  hasKey: boolean;
  allowGenesis: boolean;
  live: LiveRules;
}

/** The verdict for one command. Pure: everything it reads, it was handed. */
export function capabilityFor(cmd: Command, ctx: CapabilityContext): Capability {
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

/**
 * The whole catalogue's verdicts, in one read of the rules.
 *
 * Callers that already hold a `LiveRules` should pass it, so the page and the
 * chat route in one request do not ask the arena twice for the same answer.
 */
export async function capabilities(live?: LiveRules): Promise<Capabilities> {
  const cfg = config();
  const resolved = live ?? (await rules());
  const ctx: CapabilityContext = {
    hasKey: hasWallet(),
    allowGenesis: cfg.allowGenesis,
    live: resolved,
  };

  const out: Capabilities = {};
  for (const cmd of COMMANDS) out[cmd.id] = capabilityFor(cmd, ctx);
  return out;
}
