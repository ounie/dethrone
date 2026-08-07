/**
 * Next's boot hook. This is the "startup" in "startup assertion".
 *
 * It runs once per server process and once per serverless cold start, before
 * any request is served, so a throw here crashes `next dev` at start and fails
 * the first cold start in production with the reason in the log — rather than
 * surfacing three layers down on the first click, after a request has already
 * left the process.
 *
 * The build is gated separately by `scripts/assert-config.ts`, because a
 * serverless deploy has no startup you can fail a *deployment* on.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { config } = await import("./lib/config");
  config();
}
