import type { NextConfig } from "next";

/**
 * Nothing clever here on purpose.
 *
 * The boot assertions do NOT live in this file. Next evaluates the config in
 * more contexts than it evaluates the app — `next lint`, `next info`, an editor
 * plugin — and an assertion that throws here fails commands that were never
 * going to spend anything. They run in two places that actually matter instead:
 * `scripts/assert-config.ts`, which gates `pnpm build`, and
 * `src/instrumentation.ts`, which gates the running server.
 */
const nextConfig: NextConfig = {
  // The console renders live money. A cached seat read showing a stale pot is a
  // wrong number, and a wrong number is worse than a slow one (PRD §14).
  reactStrictMode: true,

  // The one thing the browser is allowed to know about the operator is an
  // address, and it is passed as a prop from a server component. No env var
  // crosses the boundary, so there is no `env` block here and there never
  // should be — see the NEXT_PUBLIC_ assertion in src/lib/assertions.ts.
  experimental: {},
};

export default nextConfig;
