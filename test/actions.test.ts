import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { byId, pathSegments } from "@/lib/commands";

/**
 * Sequences: five menu indices, and the shape they go out in.
 *
 * The arena's route takes `{ actions: number[] }` and refuses anything else
 * with a 400. Every arg on the console's wire is a string, so there is exactly
 * one place the conversion happens and exactly one way it can be wrong — an
 * array of strings instead of numbers looks identical in a log and fails at the
 * far end. This file pins it.
 *
 * What is deliberately NOT asserted here is the LENGTH or the upper bound.
 * Five, and 0..15, are the canon's rules. Re-stating them in the console would
 * be a second implementation of the game, and on the day the menu grows the
 * copy here would be the one that is wrong.
 */

const KEY = "0x" + "e".repeat(64);
const call = vi.fn();

vi.mock("@/lib/arena", () => ({
  call: (...args: unknown[]) => call(...args),
  replay: vi.fn(),
  interfaceMatches: () => true,
}));

function ok(body: unknown = { submitted: true }) {
  return {
    result: {
      status: 200,
      ok: true,
      ms: 9,
      body,
      interfaceVersion: "interface-v2",
      featureDisabled: false,
      settlement: null,
    },
    attempt: {},
  };
}

async function post(payload: unknown) {
  const { POST } = await import("@/app/api/act/route");
  const res = await POST(
    new Request("http://127.0.0.1:3939/api/act", {
      method: "POST",
      headers: { host: "127.0.0.1:3939", "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, never> };
}

beforeEach(() => {
  vi.resetModules();
  call.mockReset();
  call.mockResolvedValue(ok());
  process.env.DETHRONE_PRIVATE_KEY = KEY;
  process.env.DETHRONE_BASE_URL = "http://127.0.0.1:3000";
  process.env.HOST = "127.0.0.1";
  delete process.env.VERCEL;
});

describe("the catalogue entries", () => {
  it("legal_actions is a free read with no wallet", () => {
    const cmd = byId("legal_actions")!;
    expect(cmd.tier).toBe("free");
    expect(cmd.method).toBe("GET");
    expect(pathSegments(cmd.path)).toEqual(["id"]);
  });

  it("submit_actions is signed, and signs the scope the route verifies", () => {
    const cmd = byId("submit_actions")!;
    expect(cmd.tier).toBe("signed");
    expect(cmd.method).toBe("POST");
    // The arena calls verifySigned(req, `match:${matchId}`).
    expect(cmd.signScope).toBe("match:{id}");
  });

  it("submit_actions costs nothing — the challenge fee already paid for the match", () => {
    expect(byId("submit_actions")!.cents).toBe(0);
  });
});

describe("the sequence goes out as an array of integers", () => {
  it("sends numbers, not strings", async () => {
    await post({ id: "submit_actions", args: { id: "mat_1", actions: "[3,7,0,12,5]" } });

    const sent = call.mock.calls[0][0] as { body?: { actions?: unknown } };
    expect(sent.body?.actions).toEqual([3, 7, 0, 12, 5]);
    for (const a of sent.body!.actions as unknown[]) expect(typeof a).toBe("number");
  });

  it("preserves order — exchange order is the whole meaning of the field", async () => {
    await post({ id: "submit_actions", args: { id: "mat_1", actions: "[12,0,7,3,5]" } });
    expect((call.mock.calls[0][0] as { body: { actions: number[] } }).body.actions).toEqual([
      12, 0, 7, 3, 5,
    ]);
  });

  it("signs match:{id} with the real match id", async () => {
    await post({ id: "submit_actions", args: { id: "mat_abc", actions: "[1,2,3,4,5]" } });
    const sent = call.mock.calls[0][0] as { headers: Record<string, string>; path: string };
    expect(sent.path).toBe("/api/match/mat_abc/actions");
    expect(Object.keys(sent.headers).sort()).toEqual(["x-signature", "x-timestamp", "x-wallet"]);
    expect(sent.headers["x-wallet"]).toBe(privateKeyToAccount(KEY as `0x${string}`).address);
  });

  it("refuses a malformed sequence locally, with nothing leaving the process", async () => {
    for (const bad of ["not json", '{"a":1}', "[1,2,\"three\"]", "[1.5]"]) {
      call.mockClear();
      const res = await post({ id: "submit_actions", args: { id: "mat_1", actions: bad } });
      expect(res.body.error, `accepted ${bad}`).toMatchObject({ code: "CONSOLE_BAD_FIELD" });
      expect(call).not.toHaveBeenCalled();
    }
  });

  it("does NOT enforce length or bounds — those are the canon's rules", async () => {
    // Three actions and an index of 99 are both wrong, and both are the arena's
    // to refuse. The console forwards them and renders the 400.
    await post({ id: "submit_actions", args: { id: "mat_1", actions: "[1,2,99]" } });
    expect((call.mock.calls[0][0] as { body: { actions: number[] } }).body.actions).toEqual([
      1, 2, 99,
    ]);
  });
});
