/**
 * The build gate.
 *
 * `pnpm build` runs this before `next build`, which is what makes the PRD's
 * acceptance criterion literally true: *a Vercel production deploy with a key
 * and no CONSOLE_PROTECTION_CONFIRMED fails to start, with the reason in the
 * build log.* A serverless platform gives you no process start to fail on, so
 * the deploy has to be refused at the only moment you control — the build.
 *
 * It is also the only point at which the NEXT_PUBLIC_ scan means anything: that
 * prefix is inlined into the client bundle at build time, so a boot-time scan
 * of an already-built bundle is too late to matter.
 *
 * This deliberately does not import from `src/lib/config.ts` — that module is
 * marked `server-only`, which is a Next build-time construct and not something
 * a bare `tsx` process can resolve. It calls the pure assertions directly.
 */
import { assertConsoleConfig } from "../src/lib/assertions";

function hostFromEnv(): string | null {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--hostname" || argv[i] === "-H") return argv[i + 1] ?? null;
  }
  return process.env.HOST ?? process.env.HOSTNAME ?? null;
}

const findings = assertConsoleConfig(process.env, hostFromEnv());
const failures = findings.filter((f) => f.level === "fail");
const warnings = findings.filter((f) => f.level === "warn");

for (const w of warnings) {
  console.warn(`[console] warning  ${w.code}\n           ${w.message}\n`);
}

if (failures.length > 0) {
  console.error("\nDethrone Console refuses to build:\n");
  for (const f of failures) {
    console.error(`  ${f.code}\n    ${f.message}\n`);
  }
  process.exit(1);
}

console.log(
  `[console] configuration OK (${warnings.length} warning${warnings.length === 1 ? "" : "s"})`,
);
