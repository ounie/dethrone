import { describe, expect, it } from "vitest";
import { COMMANDS } from "@/lib/commands";
import { INTERFACE_VERSION } from "@/lib/interface";

/**
 * The only test that asks the real arena. Opt in with `pnpm test:live`.
 *
 * ## Why it exists when catalogue-drift.test.ts already checks the routes
 *
 * That test compares the catalogue against `test/canon-routes.json`, which is a
 * snapshot taken from a checkout at a named commit. A snapshot cannot know
 * about a route deleted the day after it was taken — and a deleted route is
 * precisely the failure that produced the three phantom commands this console
 * was rewritten to remove.
 *
 * So this suite asks the live server, using a deliberately bogus id, and checks
 * only one thing: did the response carry `X-Dethrone-Interface`? Every /api/*
 * response does, success or refusal. Its presence means a route answered.
 * Its ABSENCE on a 404 means Next itself answered — there is no such route.
 *
 * It never sends a paid or signed command, so it costs nothing and needs no key.
 */

const BASE = (process.env.DETHRONE_BASE_URL ?? "https://dethrone.bot").replace(/\/+$/, "");
const LIVE = process.env.DETHRONE_LIVE === "1";

/** A value no real record will have, so nothing is disturbed by asking. */
const BOGUS = "console-live-probe-0";

function probePath(path: string): string {
  return path.replace(/:[a-zA-Z][a-zA-Z0-9_]*/g, BOGUS);
}

describe.skipIf(!LIVE)(`the arena at ${BASE} still serves the catalogue`, () => {
  const reads = COMMANDS.filter((c) => c.tier === "free" && c.method === "GET");

  it("has at least twenty free reads to check", () => {
    expect(reads.length).toBeGreaterThan(20);
  });

  for (const cmd of reads) {
    it(`${cmd.id} → GET ${cmd.path} reaches a route`, async () => {
      const res = await fetch(BASE + probePath(cmd.path), {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const version = res.headers.get("x-dethrone-interface");
      expect(
        version,
        `${cmd.path} answered ${res.status} with no interface header — this server has no such route`,
      ).not.toBeNull();
      expect(version, "the pinned interface has moved").toBe(INTERFACE_VERSION);
    });
  }

  it("GET /api/rules reports the interface this console was written against", async () => {
    const res = await fetch(`${BASE}/api/rules`, { cache: "no-store" });
    const body = (await res.json()) as { interface?: string };
    expect(body.interface).toBe(INTERFACE_VERSION);
  });

  it("POST /api/forge refuses a body — the fighter derives from the wallet", async () => {
    const res = await fetch(`${BASE}/api/forge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "a knight" }),
    });
    // 400 BAD_REQUEST, not a 402: the body is rejected before any price is
    // quoted. This is the assertion that keeps the catalogue's "no body" honest.
    expect(res.status).toBe(400);
  });
});
