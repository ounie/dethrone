/**
 * Regenerate `test/canon-routes.json` from a checkout of the arena.
 *
 *   pnpm canon:sync ../dethrone/apps/web
 *
 * ## Why a committed manifest and not an import
 *
 * The console is a separate, public repository. It cannot import the arena's
 * route tree, and the arena publishes no client package — so the catalogue has
 * nothing to be checked against at compile time. A committed manifest with a
 * stated provenance is the honest substitute: it records what the routes were
 * on a named commit, the drift test compares the catalogue against it in both
 * directions, and regenerating it is one command that shows exactly what moved.
 *
 * The manifest is *not* the source of truth and cannot be. That is why
 * `test/live/canon.live.test.ts` exists: it asks the real server, and it is the
 * only check that catches a route deleted after the last sync.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("usage: pnpm canon:sync <path-to-apps/web>");
  process.exit(1);
}

const webRoot = resolve(process.cwd(), target);
const apiRoot = join(webRoot, "src/app/api");

let sha = "unknown";
try {
  sha = execFileSync("git", ["-C", webRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  // A checkout without git history still produces a usable manifest.
}

interface Route {
  path: string;
  methods: string[];
  /** The env flag whose falsity makes this route 404, if any. */
  flag: string | null;
  /** The scope string passed to verifySigned, if the route is signed. */
  signScope: string | null;
  paid: boolean;
  adminOnly: boolean;
  cronOnly: boolean;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

/** `.../api/duel/[id]/take/route.ts` → `/api/duel/[id]/take` */
function routePath(file: string): string {
  const rel = relative(join(webRoot, "src/app"), file).replace(/\/route\.ts$/, "");
  return "/" + rel;
}

const routes: Route[] = walk(apiRoot)
  .map((file) => {
    const src = readFileSync(file, "utf8");
    // Two shapes, both in use: a declared handler per method, and a single
    // handler re-exported under several names (`export { handler as GET, ... }`,
    // which is how the MCP route and anything else built from a factory does it).
    const methods = ["GET", "POST", "DELETE", "PUT", "PATCH"].filter(
      (m) =>
        new RegExp(`export (?:async )?function ${m}\\b`).test(src) ||
        new RegExp(`export (?:const|let) ${m}\\b`).test(src) ||
        new RegExp(`export\\s*\\{[^}]*\\bas ${m}\\b`, "s").test(src),
    );
    const flag = /env\(\)\.([A-Z_]+_ENABLED)/.exec(src)?.[1] ?? null;
    const scope = /verifySigned\(\s*req,\s*[`"]([^`"]+)[`"]/.exec(src)?.[1] ?? null;
    return {
      path: routePath(file),
      methods,
      flag,
      signScope: scope,
      paid: /withX402|paidRoute|x402Wrap/.test(src),
      adminOnly: /x-admin-token|requireAdmin|ADMIN_TOKEN/.test(src),
      cronOnly: /cronAuthorized/.test(src),
    };
  })
  .filter((r) => r.methods.length > 0)
  .sort((a, b) => a.path.localeCompare(b.path));

const manifest = {
  $comment:
    "GENERATED — do not edit by hand. Regenerate with `pnpm canon:sync <path-to-apps/web>`. This records the arena's route tree at the commit below; it is a checked-in snapshot, not a source of truth. test/live/canon.live.test.ts is what catches a route deleted after this was taken.",
  source: "apps/web/src/app/api/**/route.ts",
  commit: sha,
  routeCount: routes.length,
  routes,
};

const out = join(import.meta.dirname, "../test/canon-routes.json");
writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(`[canon:sync] wrote ${routes.length} routes from ${sha.slice(0, 8)} → ${out}`);
