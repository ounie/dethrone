import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * This file exists for exactly one reason: to make `@/` resolve under vitest
 * the way it resolves under `tsc` and `next build`.
 *
 * Move the alias in tsconfig.json, move it here. They are two declarations of
 * one fact, and when they disagree the tests pass by coincidence.
 */
export default defineConfig({
  // JSX, stated explicitly rather than inherited. `next build` rewrites
  // tsconfig.json's `jsx` field to whatever it wants, so a test suite that
  // relies on that value is one build away from failing to parse. Vite 8
  // transforms with oxc rather than esbuild, so the setting lives here.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The live suite talks to the real canon. Opt in with `pnpm test:live`.
    exclude: ["test/live/**", "node_modules/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // See test/stubs/server-only.ts for why this alias is safe.
      "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
    },
  },
});
