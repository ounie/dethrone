import { describe, expect, it } from "vitest";
import {
  CONSOLE_ERROR_CODES,
  CONSOLE_ERROR_ENGLISH,
  CONSOLE_ERROR_STATUS,
  namespacesAreDisjoint,
} from "@/lib/errors";
import { ERROR_CODES } from "@/lib/interface";

/**
 * PRD §3: *errors render `error.code`, never prose. The closed set is inherited
 * from the interface PRD and is not extended here. Console-local failures use a
 * disjoint namespace prefixed `CONSOLE_`.*
 *
 * The disjointness is the load-bearing part. A `CONSOLE_` code means this app
 * stopped the request and nothing was charged; any other code means the arena
 * answered, and one of those answers may have cost money. A client that cannot
 * tell them apart will eventually report a local seatbelt as a game rule.
 */
describe("the two error namespaces", () => {
  it("do not overlap", () => {
    expect(namespacesAreDisjoint()).toBe(true);
  });

  it("the canon has minted no code beginning CONSOLE_", () => {
    expect(ERROR_CODES.filter((c) => c.startsWith("CONSOLE_"))).toEqual([]);
  });

  it("every console code carries the prefix", () => {
    for (const code of CONSOLE_ERROR_CODES) expect(code.startsWith("CONSOLE_")).toBe(true);
  });

  it("every console code has a status and a gloss", () => {
    for (const code of CONSOLE_ERROR_CODES) {
      expect(CONSOLE_ERROR_STATUS[code], code).toBeGreaterThanOrEqual(400);
      expect(CONSOLE_ERROR_ENGLISH[code]?.length ?? 0, code).toBeGreaterThan(10);
    }
  });

  it("the confirmation is 428, because the request was well-formed", () => {
    expect(CONSOLE_ERROR_STATUS.CONSOLE_CONFIRM_REQUIRED).toBe(428);
  });

  it("the in-flight payment code tells the operator NOT to retry", () => {
    expect(CONSOLE_ERROR_ENGLISH.CONSOLE_PAYMENT_INFLIGHT).toMatch(/do not re-run/i);
  });
});
