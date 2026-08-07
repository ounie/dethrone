import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { SRC, read, rel, sourceFiles } from "./graph";

/**
 * PRD §3: *no hand-typed money.* A source assertion over `src/app/**` and
 * `src/components/**` fails on `/\$\s*\d/` and on any bare `_CENTS`/`_USDC`
 * numeric literal outside `src/lib/commands.ts`, which holds labels and the
 * ceiling only.
 *
 * ## Why the allowlist is empty
 *
 * `DEFAULT_MAX_SPEND_CENTS` and `DEFAULT_CONFIRM_OVER_CENTS` live in
 * `commands.ts` rather than in `config.ts`, which reads backwards until you
 * notice it is the only arrangement in which this test needs no exceptions.
 * An allowlist with one entry acquires a second, and the fifth is a price.
 */

const SCANNED = [join(SRC, "app"), join(SRC, "components")];

/** A price a human typed, rather than a number the arena sent. */
const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "a dollar amount", re: /\$\s*\d/ },
  { name: "a _CENTS or _USDC constant", re: /\b[A-Za-z_]*_(CENTS|USDC)\b\s*[:=]\s*\d/ },
  { name: "a bare cents/USDC quantity", re: /\b\d+\s*(cents?|USDC|usdc)\b/ },
  { name: "a number assigned to a money-shaped name", re: /\b\w*(cents|usdc|price|fee)\w*\s*[:=]\s*\d+/i },
];

describe("no hand-typed money in the UI", () => {
  const files = SCANNED.flatMap((dir) => sourceFiles(dir));

  it("scans a non-empty set of files", () => {
    expect(files.length).toBeGreaterThan(4);
  });

  for (const file of files) {
    it(`${rel(file)} contains no currency literal`, () => {
      const source = read(file);
      const hits: string[] = [];

      source.split("\n").forEach((line, i) => {
        for (const { name, re } of PATTERNS) {
          if (re.test(line)) hits.push(`  ${rel(file)}:${i + 1}  ${name}\n    ${line.trim()}`);
        }
      });

      expect(hits, hits.length ? `\n${hits.join("\n")}` : "").toEqual([]);
    });
  }

  it("commands.ts is the only module holding the ceiling defaults", () => {
    const catalogue = read(join(SRC, "lib/commands.ts"));
    expect(catalogue).toMatch(/export const DEFAULT_MAX_SPEND_CENTS = \d+;/);
    expect(catalogue).toMatch(/export const DEFAULT_CONFIRM_OVER_CENTS = \d+;/);

    for (const file of sourceFiles()) {
      if (file === join(SRC, "lib/commands.ts")) continue;
      expect(read(file), `${rel(file)} declares a ceiling default`).not.toMatch(
        /(?:const|let)\s+DEFAULT_(MAX_SPEND|CONFIRM_OVER)_CENTS\s*=/,
      );
    }
  });
});
