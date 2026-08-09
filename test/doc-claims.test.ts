import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS, EXCLUDED_ROUTES } from "@/lib/commands";

/**
 * The prose has to answer to the catalogue too.
 *
 * Every other test in here guards a property of the code. This one guards two
 * claims made *about* the code, in files no test could previously see — and
 * both were wrong at the same time, in the README, on the screen, and in a
 * source comment:
 *
 *   1. **"27 reads of the canon."** A hand-typed count of a list that grew.
 *      `COMMANDS` had thirty free entries by the time anybody noticed, and the
 *      console's own screenshot showed `FREE READS 30` beside a README saying
 *      twenty-seven.
 *
 *   2. **"`GET /api/treasury` is the ledger."** That route is `ADMIN_TOKEN`,
 *      which `EXCLUDED_ROUTES` in `commands.ts` has always said in as many
 *      words. So the catalogue and the documentation disagreed in print, and
 *      the documentation was the half a reader believes. Naming an endpoint
 *      somebody cannot call as their receipt is worse than naming none: it
 *      reads as an audit trail right up until the 401.
 *
 * Both are the same defect — a number or a URL typed once into prose, with
 * nothing checking it — and prose is exactly where this product makes its
 * argument, so it is worth a test rather than an apology.
 */

const root = join(__dirname, "..");
const file = (rel: string) => readFileSync(join(root, rel), "utf8");

/**
 * Everything a reader looks at: docs, and the copy rendered on the screen.
 *
 * `CLAUDE.md` is included when present and skipped when it is not — it is
 * **gitignored on purpose** ("the agent guide is local, not published"), so it
 * is absent from every fresh clone and from CI. Reading it unconditionally
 * passes on the machine that wrote this test and throws ENOENT everywhere else,
 * which is the worst way for a guard to fail.
 */
function proseFiles(): string[] {
  const out = ["README.md", "CLAUDE.md"].filter((f) => existsSync(join(root, f)));
  const walk = (rel: string) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      if (e.isDirectory()) walk(`${rel}/${e.name}`);
      else if (/\.(tsx|md)$/.test(e.name)) out.push(`${rel}/${e.name}`);
    }
  };
  walk("src");
  return out;
}

describe("the documented free-read count is the real one", () => {
  it("matches COMMANDS rather than a number somebody typed", () => {
    const free = COMMANDS.filter((c) => c.tier === "free").length;
    const readme = file("README.md");
    const claimed = /\|\s*\*\*Free\*\*\s*\|\s*(\d+)\s+reads\b/.exec(readme);
    expect(claimed, "the README's Free row no longer states a count in the expected shape").not.toBe(
      null,
    );
    expect(
      Number(claimed?.[1]),
      `the README says ${claimed?.[1]} free reads; the catalogue has ${free}`,
    ).toBe(free);
  });
});

describe("no prose offers a route the console cannot call", () => {
  /**
   * The excluded routes, as a reader would type them. An exclusion exists
   * precisely because this console has no way to reach the route, so naming one
   * in documentation is always a promise it cannot keep.
   *
   * `commands.ts` itself is exempt: it is where the exclusion and its reason are
   * written, and it must name the path to exclude it. So is this file.
   */
  const excluded = EXCLUDED_ROUTES.map((e) => e.path).filter((p) => !p.includes("["));

  it("names none of them as a record, ledger, or receipt", () => {
    expect(excluded.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const rel of proseFiles()) {
      if (rel.endsWith("lib/commands.ts")) continue;
      /*
        Comments stripped from source files, because the rule is about what a
        reader SEES — and the comment recording this very correction has to
        quote the sentence it corrects. That is the trap `commands.ts` already
        carries a warning about, one level up: the arena's canon sync decided a
        route was paid by grepping for a wrapper its doc comment merely denied,
        and then the comment explaining THAT did it again.

        Markdown has no comment syntax to strip and needs none: its correction
        says the route "used to be pointed at AS the ledger", which is a
        different sentence from claiming it IS one.
      */
      const src = /\.tsx$/.test(rel)
        ? file(rel)
            .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\/\/[^\n]*/g, "")
        : file(rel);
      for (const path of excluded) {
        // The claim, not the mention. A file may say "that route is admin-only"
        // — that sentence is the correction, and banning the path outright
        // would delete the explanation along with the error.
        const claim = new RegExp(
          `${path.replace(/\//g, "\\/")}[^.]{0,80}?\\b(is|are)\\s+the\\s+(ledger|record|receipt)`,
          "i",
        );
        if (claim.test(src)) offenders.push(`${rel} → ${path}`);
      }
    }
    expect(
      offenders,
      `these call a route the console cannot reach the record: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("proves the gate still bites", () => {
    // A regex this shape is one edit from matching nothing, and a claim gate
    // that silently stopped working reads exactly like disciplined prose.
    const path = excluded[0];
    const bad = `Reconciliation is the arena's: \`GET ${path}\` is the ledger.`;
    const claim = new RegExp(
      `${path.replace(/\//g, "\\/")}[^.]{0,80}?\\b(is|are)\\s+the\\s+(ledger|record|receipt)`,
      "i",
    );
    expect(claim.test(bad), "the gate should catch the sentence that caused this").toBe(true);
    expect(
      claim.test(`\`GET ${path}\` is ADMIN_TOKEN and the console excludes it.`),
      "the gate should allow the correction",
    ).toBe(false);
  });
});
