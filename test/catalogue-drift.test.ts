import { describe, expect, it } from "vitest";
import manifest from "./canon-routes.json";
import {
  CALLER_PRICED,
  COMMANDS,
  DUEL_STAKE_PRESET_CENTS,
  EXCLUDED_ROUTES,
  isCallerPriced,
  pathSegments,
  scopePlaceholders,
} from "@/lib/commands";

/**
 * PRD §11: *every catalogue entry's `id` resolves in the route's switch, and
 * every switch branch has a catalogue entry — a drift test in both directions.*
 *
 * There is no switch. `/api/act` is driven entirely by the catalogue, which is
 * an improvement — a switch is precisely where per-command rules accumulate —
 * so the invariant is restated as the properties the switch was protecting, and
 * then extended in the direction that actually matters: **against the arena**.
 *
 * The second half of this file is the test that would have caught the three
 * phantom commands an earlier draft of this console shipped
 * (`POST /api/pot/tip`, `GET /api/match/:id/stream`,
 * `POST /api/match/:id/forge`) — none of which has ever existed.
 */

/** `/api/duel/:id/take` → `/api/duel/[id]/take`, the manifest's spelling. */
function toManifestPath(path: string): string {
  return path.replace(/:([a-zA-Z][a-zA-Z0-9_]*)/g, "[$1]");
}

const manifestByPath = new Map(manifest.routes.map((r) => [r.path, r]));

describe("the catalogue is internally consistent", () => {
  it("every id is unique", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size, `duplicate ids: ${ids.join(", ")}`).toBe(ids.length);
  });

  it("every :segment has a field of the same name", () => {
    for (const cmd of COMMANDS) {
      const names = new Set((cmd.fields ?? []).map((f) => f.name));
      for (const segment of pathSegments(cmd.path)) {
        expect(names.has(segment), `${cmd.id}: :${segment} has no field`).toBe(true);
      }
    }
  });

  it("every :segment field is required (an optional one would send a literal ':id')", () => {
    for (const cmd of COMMANDS) {
      const segments = new Set(pathSegments(cmd.path));
      for (const field of cmd.fields ?? []) {
        if (!segments.has(field.name)) continue;
        // `derive`'s address is the one exception: the route defaults it to the
        // operator's own address, so an empty box is a filled path.
        if (field.name === "address") continue;
        expect(field.optional ?? false, `${cmd.id}: :${field.name} is optional`).toBe(false);
      }
    }
  });

  it("every signScope placeholder is a field of the same command", () => {
    for (const cmd of COMMANDS) {
      if (!cmd.signScope) continue;
      const names = new Set((cmd.fields ?? []).map((f) => f.name));
      for (const placeholder of scopePlaceholders(cmd.signScope)) {
        expect(names.has(placeholder), `${cmd.id}: {${placeholder}} has no field`).toBe(true);
      }
    }
  });

  it("every signed command has a scope, and only signed commands have one", () => {
    for (const cmd of COMMANDS) {
      expect(!!cmd.signScope, `${cmd.id}`).toBe(cmd.tier === "signed");
    }
  });

  it("every caller-priced command names where its amount comes from", () => {
    for (const cmd of COMMANDS) {
      if (cmd.cents !== CALLER_PRICED) continue;
      expect(
        !!cmd.amountField || cmd.maxField === true,
        `${cmd.id}: caller-priced but names neither an amountField nor a maxField`,
      ).toBe(true);
    }
  });

  it("only paid commands carry a price hint above zero", () => {
    for (const cmd of COMMANDS) {
      if (cmd.tier === "paid") continue;
      expect(cmd.cents, `${cmd.id}`).toBe(0);
    }
  });

  it("every livePrice key is one the rules probe publishes", () => {
    const known = new Set(["forge", "challenge", "filmOrder"]);
    for (const cmd of COMMANDS) {
      if (!cmd.livePrice) continue;
      expect(known.has(cmd.livePrice), `${cmd.id}: ${cmd.livePrice}`).toBe(true);
    }
  });
});

/**
 * Every command says what it does, in the Command pane, before it is pressed.
 *
 * Twenty-three of fifty-one carried no `note` at all, so the pane rendered a
 * route and a price and nothing else — and a route is not a description to
 * anyone who has not read the arena's source. The catalogue is the only place
 * this console is allowed to keep that sentence, so this is where it is
 * checked.
 *
 * The notes describe the ENDPOINT, never the rules. "Returns every open heir
 * listing" is this console's business; what makes an heir listable is the
 * arena's, and a note that drifted into eligibility or timing would be the
 * second implementation of the game that `CLAUDE.md`'s first rule forbids.
 * That half cannot be tested — it is a reading — so the cheap half is tested
 * here and the expensive half is written down.
 */
/**
 * The stake presets are a suggestion, and the canon is what bounds them.
 *
 * They live in `commands.ts` because it is the only file under `src/` allowed a
 * currency literal — which means this is the only place they can be checked
 * against the command they belong to.
 */
describe("the duel stake presets", () => {
  it("are ordered, positive and distinct", () => {
    const p = [...DUEL_STAKE_PRESET_CENTS];
    expect(p.length).toBeGreaterThan(0);
    expect(p.every((c) => Number.isInteger(c) && c > 0)).toBe(true);
    expect(p).toEqual([...p].sort((a, b) => a - b));
    expect(new Set(p).size).toBe(p.length);
  });

  it("belong to a command that actually takes a stake", () => {
    // If `post_duel` ever stopped being caller-priced, a row of amount buttons
    // would be offering to fill a field the arena no longer prices that way.
    const duel = COMMANDS.find((c) => c.id === "post_duel");
    expect(duel?.amountField).toBe("stake");
    expect(isCallerPriced(duel!)).toBe(true);
  });
});

describe("every command carries a description", () => {
  it("has a note", () => {
    const silent = COMMANDS.filter((c) => !c.note?.trim()).map((c) => c.id);
    expect(silent, `no note: ${silent.join(", ")}`).toEqual([]);
  });

  it("says more than the route already says", () => {
    // A note that just restates the path is a note nobody needed. Short enough
    // to be a label rather than a sentence is the signal.
    const thin = COMMANDS.filter((c) => (c.note ?? "").trim().length < 25).map((c) => c.id);
    expect(thin, `too thin to be a description: ${thin.join(", ")}`).toEqual([]);
  });

  it("quotes no price, which is the arena's to publish", () => {
    // Same rule `currency-literals` enforces on the app and the components,
    // applied by hand here because this is the one file exempt from it.
    const priced = COMMANDS.filter((c) => /\$\s*\d|\b\d+\s*(cents|usdc)\b/i.test(c.note ?? ""));
    expect(priced.map((c) => c.id), "a note names an amount").toEqual([]);
  });
});

describe("the catalogue matches the arena — direction A: nothing invented", () => {
  for (const cmd of COMMANDS) {
    it(`${cmd.id} → ${cmd.method} ${cmd.path} exists on the canon`, () => {
      const route = manifestByPath.get(toManifestPath(cmd.path));
      expect(route, `no such route in the manifest: ${toManifestPath(cmd.path)}`).toBeDefined();
      expect(
        route!.methods.includes(cmd.method),
        `${cmd.path} serves ${route!.methods.join("/")}, not ${cmd.method}`,
      ).toBe(true);
    });
  }
});

describe("the catalogue matches the arena — direction B: nothing missed", () => {
  const excluded = new Set(EXCLUDED_ROUTES.map((e) => e.path));
  const registered = new Set(COMMANDS.map((c) => toManifestPath(c.path)));

  it("every excluded route still exists (an exclusion that no longer applies is itself drift)", () => {
    for (const entry of EXCLUDED_ROUTES) {
      expect(
        manifestByPath.has(entry.path),
        `${entry.path} is excluded but no longer exists — delete the exclusion`,
      ).toBe(true);
      expect(entry.reason.length, `${entry.path} has no reason`).toBeGreaterThan(10);
    }
  });

  it("every public route is either registered or excluded with a reason", () => {
    const unaccounted = manifest.routes
      .filter((r) => !r.adminOnly && !r.cronOnly)
      .filter((r) => !registered.has(r.path) && !excluded.has(r.path))
      .map((r) => `${r.methods.join("/")} ${r.path}`);

    expect(
      unaccounted,
      `these routes exist and the catalogue neither registers nor excludes them:\n  ${unaccounted.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("the signed scopes are the canon's own", () => {
  for (const cmd of COMMANDS) {
    const scope = cmd.signScope;
    if (!scope) continue;
    it(`${cmd.id} signs the scope the route verifies`, () => {
      const route = manifestByPath.get(toManifestPath(cmd.path));
      if (!route?.signScope) return; // GET /api/match/[id] verifies conditionally
      // The manifest records the server's template as `character:${characterId}`;
      // the catalogue's is `character:{id}`. Compare the prefix, which is the
      // part that must not drift — the id itself is filled at request time.
      const serverPrefix = route.signScope.split(":")[0];
      const ourPrefix = scope.split(":")[0];
      expect(ourPrefix, `${cmd.id}: signs "${ourPrefix}", route verifies "${serverPrefix}"`).toBe(
        serverPrefix,
      );
    });
  }
});
