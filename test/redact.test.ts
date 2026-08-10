import { describe, expect, it } from "vitest";
import { redact } from "@/lib/redact";
import { CORPUS, FIXTURE_KEY, FIXTURE_SIGNATURE } from "./fixtures/redact-corpus";

/**
 * PRD §11: *no response from `/api/act` contains a participant token, a
 * signature, or an `x-payment` value — asserted by running the redactor's test
 * corpus over recorded responses.*
 */
describe("the redactor", () => {
  for (const specimen of CORPUS) {
    it(specimen.name, () => {
      const json = JSON.stringify(redact(specimen.input, [FIXTURE_KEY]));

      for (const forbidden of specimen.mustNotContain) {
        expect(json.includes(forbidden), `leaked: ${forbidden.slice(0, 24)}…`).toBe(false);
      }
      for (const required of specimen.mustContain) {
        expect(json.includes(required), `destroyed: ${required.slice(0, 24)}…`).toBe(true);
      }
    });
  }

  it("survives a circular structure rather than hanging", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
    expect(JSON.stringify(redact(a))).toContain("circular");
  });

  it("does not mutate its input", () => {
    const input = { signature: FIXTURE_SIGNATURE };
    redact(input, [FIXTURE_KEY]);
    expect(input.signature).toBe(FIXTURE_SIGNATURE);
  });

  it("erases every secret in the list, not just the first", () => {
    // The signature was always `secrets: string[]`, and for years the callers
    // passed exactly one. They now pass every configured wallet key plus the
    // provider credentials, so the plural path is load-bearing rather than
    // theoretical.
    const SECOND = "0x" + "e".repeat(64);
    const THIRD = "sk-ant-" + "z".repeat(24);
    const json = JSON.stringify(
      redact({ a: FIXTURE_KEY, b: SECOND, c: THIRD, keep: "0x1234" }, [
        FIXTURE_KEY,
        SECOND,
        THIRD,
      ]),
    );
    expect(json).not.toContain(FIXTURE_KEY);
    expect(json).not.toContain(SECOND);
    expect(json).not.toContain(THIRD);
    expect(json).toContain("0x1234");
  });

  it("erases a secret it was given even in an unrecognised shape", () => {
    const json = JSON.stringify(redact({ anything: `prefix${FIXTURE_KEY}suffix` }, [FIXTURE_KEY]));
    expect(json).not.toContain(FIXTURE_KEY);
    expect(json).toContain("prefix");
  });

  it("ignores an empty secret rather than redacting every character", () => {
    const json = JSON.stringify(redact({ msg: "hello" }, ["", "x"]));
    expect(json).toContain("hello");
  });
});
