import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The live suite, opted into with `pnpm test:live`.
 *
 * A separate config rather than a filter, and NOT merged with the base one:
 * `mergeConfig` concatenates `include`, so merging quietly runs the whole
 * ordinary suite as well and reports success without ever touching the network.
 * A live check that passes without going live is worse than no live check.
 */
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["test/live/**/*.test.ts"],
    exclude: ["node_modules/**"],
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
    },
  },
});
