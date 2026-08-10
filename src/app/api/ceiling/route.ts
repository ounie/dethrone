import { NextResponse } from "next/server";
import { z } from "zod";
import { config } from "@/lib/config";
import { consoleError } from "@/lib/errors";
import { spendStore } from "@/lib/spend";

/**
 * Tighten the ceiling for this sitting.
 *
 * ## Why a second route is allowed here, when `/api/act` is meant to be the
 * only one
 *
 * That invariant is about the **canon**: exactly one module may reach
 * `DETHRONE_BASE_URL`, because that is where a payment can be attached, a
 * signature minted, or a spend go uncounted. This route touches none of it. It
 * makes no outbound request at all, holds no key, and the single thing it can
 * do to the world is make the console *less* able to spend.
 *
 * So the line is drawn the same way it was drawn around `chain.ts`: a second
 * path, with its properties asserted rather than assumed.
 * `test/ceiling-route.test.ts` pins them — it only ever lowers, it never
 * reaches the arena, and it cannot re-enable a ceiling that is disabled.
 *
 * Since the ceiling became sitting-wide rather than per-address, this route
 * imports nothing from `wallet.ts` at all. It was already unable to spend; now
 * it cannot even see who would.
 *
 * ## One-way, by construction
 *
 * The store's `tighten` is a `Math.min`, not an assignment, so a request to
 * raise the cap is not refused so much as ignored — there is no code path here
 * that can produce a larger number. Raising stays in `.env.local` behind a
 * restart, because loosening a seatbelt should cost more than one click at the
 * moment it stops you.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ capCents: z.number().int().positive() });

export async function POST(req: Request): Promise<NextResponse> {
  let cfg;
  try {
    cfg = config();
  } catch (err) {
    const { status, body } = consoleError("CONSOLE_MISCONFIGURED", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(body, { status });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const { status, body } = consoleError("CONSOLE_BAD_FIELD", { field: "capCents" });
    return NextResponse.json(body, { status });
  }

  const store = spendStore();

  if (!store.enabled) {
    // Offering a control that cannot bind would be the same lie the disabled
    // ceiling exists to avoid telling.
    const { status, body } = consoleError("CONSOLE_CEILING_DISABLED", { reason: store.reason });
    return NextResponse.json(body, { status });
  }

  const before = await store.cap();
  const result = await store.tighten(parsed.data.capCents);
  const ledger = await store.read();

  return NextResponse.json({
    ceiling: {
      enabled: true,
      spentCents: ledger?.spentCents ?? 0,
      cap: result.cap,
    },
    changed: result.changed,
    /** Stated plainly so a caller that tried to raise it is not left guessing. */
    note: result.changed
      ? `Ceiling lowered to ${result.cap} cents for this sitting.`
      : `Unchanged. The ceiling only tightens — it is already ${before} cents. Raise it with CONSOLE_MAX_SPEND_CENTS in .env.local and restart.`,
    configuredCap: cfg.maxSpendCents,
  });
}
