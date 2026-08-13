import { describe, expect, it } from "vitest";
import { COMMANDS, OPT_INS, type OptIn } from "@/lib/commands";
import { capabilityFor } from "@/lib/registry";

/**
 * Explicit opt-ins grant exactly themselves.
 *
 * ## The bug this exists for
 *
 * `requiresOptIn` was a union of ONE value — `"CONSOLE_ALLOW_GENESIS"` — and
 * `capabilityFor` checked it against a hardcoded `ctx.allowGenesis` boolean:
 *
 *     if (cmd.requiresOptIn && !ctx.allowGenesis) { … }
 *
 * That reads as "is this command's opt-in granted" and is really "is the
 * genesis opt-in granted". With one opt-in the two are the same sentence, so
 * nothing was wrong and nothing could catch it. The second one is where they
 * come apart: a deploy that set `CONSOLE_ALLOW_GENESIS=true` to sell one $402
 * title would silently have enabled a $40,200 patronage pledge as well — a
 * command whose whole reason for being gated is that it must not be reachable
 * by accident.
 *
 * The check now looks the command's own literal up in a set. These cases are
 * what stop it going back, and they are written over `OPT_INS` rather than over
 * the two names, so a third opt-in is covered the day it is added.
 */

const ctx = (granted: OptIn[]) => ({
  hasKey: true,
  optIns: new Set(granted),
  live: {
    reachable: true,
    interfaceMatches: true,
    interfaceVersion: "interface-v2",
    money: {},
    duel: { enabled: true },
  },
});

const gated = COMMANDS.filter((c) => c.requiresOptIn);

describe("explicit opt-ins", () => {
  it("covers every opt-in the catalogue declares", () => {
    // A `requiresOptIn` value absent from `OPT_INS` cannot be granted by any
    // environment, so the command would be permanently unreachable — the type
    // makes that impossible, and this says so out loud.
    for (const cmd of gated) {
      expect(OPT_INS, `${cmd.id} names an opt-in nothing can grant`).toContain(cmd.requiresOptIn);
    }
    expect(gated.length).toBeGreaterThanOrEqual(2);
  });

  it("disables a gated command when nothing is granted", () => {
    for (const cmd of gated) {
      const cap = capabilityFor(cmd, ctx([]) as never);
      expect(cap.enabled, cmd.id).toBe(false);
      // The reason names the variable to set, so an operator is not left
      // guessing which of several it was.
      expect(cap.reason, cmd.id).toContain(cmd.requiresOptIn!);
    }
  });

  it("enables a gated command only by its OWN variable", () => {
    for (const cmd of gated) {
      expect(capabilityFor(cmd, ctx([cmd.requiresOptIn!]) as never).enabled, cmd.id).toBe(true);

      // Every OTHER opt-in, granted alone, must leave it disabled. This is the
      // assertion that would have failed under the old boolean.
      for (const other of OPT_INS) {
        if (other === cmd.requiresOptIn) continue;
        const cap = capabilityFor(cmd, ctx([other]) as never);
        expect(cap.enabled, `${cmd.id} was enabled by ${other}`).toBe(false);
      }
    }
  });

  /**
   * The pair the bug would actually have bitten, named explicitly so the
   * failure message says which two commands crossed rather than which loop
   * iteration did.
   */
  it("does not let the genesis opt-in grant a patronage pledge", () => {
    const pledge = COMMANDS.find((c) => c.id === "patronage_pledge")!;
    expect(pledge.requiresOptIn).toBe("CONSOLE_ALLOW_PATRONAGE");
    expect(capabilityFor(pledge, ctx(["CONSOLE_ALLOW_GENESIS"]) as never).enabled).toBe(false);
    expect(capabilityFor(pledge, ctx(["CONSOLE_ALLOW_PATRONAGE"]) as never).enabled).toBe(true);
  });

  it("does not let the patronage opt-in grant a genesis purchase", () => {
    const genesis = COMMANDS.find((c) => c.id === "buy_genesis")!;
    expect(genesis.requiresOptIn).toBe("CONSOLE_ALLOW_GENESIS");
    expect(capabilityFor(genesis, ctx(["CONSOLE_ALLOW_PATRONAGE"]) as never).enabled).toBe(false);
  });

  /**
   * An opt-in is not a substitute for a key. A read-only deploy holds nothing
   * that can spend, and granting the variable must not change that.
   */
  it("still refuses a granted command on a keyless deploy", () => {
    for (const cmd of gated) {
      const cap = capabilityFor(cmd, {
        ...ctx([cmd.requiresOptIn!]),
        hasKey: false,
      } as never);
      expect(cap.enabled, cmd.id).toBe(false);
    }
  });
});
