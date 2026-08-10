import { NextResponse } from "next/server";
import { z } from "zod";
import { walletKeyVars } from "@/lib/assertions";
import { autonomyStore } from "@/lib/chat/autonomy";
import { makeExecutor } from "@/lib/chat/execute";
import { systemPrompt } from "@/lib/chat/prompt";
import { adapterFor, isProviderId, providerStatuses } from "@/lib/chat/providers/registry";
import { toolsFor } from "@/lib/chat/tools";
import { TURN_TIMEOUT_MS, type ChatEvent, type ChatTurn } from "@/lib/chat/types";
import { config } from "@/lib/config";
import { consoleError, type ConsoleErrorCode } from "@/lib/errors";
import { redact } from "@/lib/redact";
import { capabilities } from "@/lib/registry";
import { spendStore } from "@/lib/spend";
import { address } from "@/lib/wallet";

/**
 * The agent's turn.
 *
 * ## Why a third route is allowed to exist
 *
 * The invariant this console is built around is about the **canon**: exactly one
 * module may construct a URL against `DETHRONE_BASE_URL`, so that exactly one
 * code path can attach a payment or mint a signature, and every guard can sit on
 * it. This route constructs none. It talks to a language model, and it reaches
 * the arena only by handing a payload to `/api/act`'s own exported handler —
 * every gate in that file runs, in the order that file documents, for every tool
 * call, including the loopback check on the Host header *this* request carried.
 *
 * `test/one-fetch.test.ts` pins that structurally rather than taking it on
 * trust: it blanks `/api/act` out of the import graph and asserts `lib/arena.ts`
 * becomes unreachable from here.
 *
 * ## What is genuinely new, and what it cost
 *
 * An egress to a third party. The operator's message, the transcript, and every
 * tool result — arena response bodies included — go to whichever provider they
 * picked. That is a real change in this application's shape, it is stated in the
 * README and in `.env.local.example`, and it is why a tool result is redacted a
 * second time on its way out, with the provider keys as secrets `/api/act` has
 * never heard of.
 *
 * ## Three kinds of request, one of which can act
 *
 * `status` reads. `autonomy` changes a mode, through a 428 challenge and echo.
 * `turn` runs the agent. The mode is never a field on any of them: it is read
 * from a server-held grant, on every tool call, by the executor.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const turnSchema = z.object({
  kind: z.literal("turn"),
  provider: z.string(),
  model: z.string().min(1),
  message: z.string().min(1).max(8_000),
  /**
   * The transcript, held by the browser because this console persists nothing.
   * Bounded so a tab left open for an afternoon cannot post a novel, and never
   * re-executed — a replayed tool call would be a second payment for one
   * command.
   */
  history: z
    .array(
      z.union([
        z.object({ role: z.literal("user"), text: z.string().max(8_000) }),
        z.object({
          role: z.literal("assistant"),
          text: z.string().max(16_000).optional(),
          toolCalls: z
            .array(
              z.object({
                id: z.string(),
                name: z.string(),
                args: z.record(z.string(), z.unknown()),
              }),
            )
            .optional(),
        }),
        z.object({
          role: z.literal("tool"),
          results: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              content: z.string().max(16_000),
              isError: z.boolean().optional(),
            }),
          ),
        }),
      ]),
    )
    .max(60)
    .default([]),
});

const requestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status") }),
  z.object({
    kind: z.literal("autonomy"),
    enable: z.boolean(),
    confirm: z
      .object({ operator: z.string(), acknowledgement: z.string(), nonce: z.string() })
      .optional(),
  }),
  turnSchema,
]);

function fail(code: ConsoleErrorCode, detail?: Record<string, unknown>): NextResponse {
  const { status, body } = consoleError(code, detail);
  return NextResponse.json(body, { status });
}

/**
 * Every secret this process holds, for the second redaction pass.
 *
 * The wallet half is resolved from `walletKeyVars` rather than named literally,
 * for the reason `/api/act` states at its own copy of this: naming the primary
 * variable by hand silently stopped being the whole list the moment a second
 * key became configurable, and this is the egress that matters most — a tool
 * result goes to a third-party model provider.
 *
 * The values are still read here rather than handed over by `wallet.ts`, which
 * has no `getPrivateKey()` and no plural of one. Only the NAMES are shared.
 */
function providerSecrets(): string[] {
  return [
    process.env.OPENROUTER_API_KEY,
    process.env.ANTHROPIC_API_KEY,
    process.env.OPENAI_COMPATIBLE_API_KEY,
    ...walletKeyVars(process.env).map((v) => process.env[v.name]),
  ].filter((v): v is string => typeof v === "string" && v.trim().length >= 8);
}

async function ceilingBlock() {
  const cfg = config();
  const store = spendStore();
  const ledger = await store.read();
  return store.enabled
    ? {
        enabled: true as const,
        spentCents: ledger?.spentCents ?? 0,
        cap: ledger?.cap ?? cfg.maxSpendCents,
      }
    : { enabled: false as const, reason: store.reason };
}

export async function POST(req: Request): Promise<NextResponse> {
  let cfg;
  try {
    cfg = config();
  } catch (err) {
    return fail("CONSOLE_MISCONFIGURED", {
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("CONSOLE_UNKNOWN_COMMAND", { reason: "malformed request" });

  const operator = address();
  const autonomy = autonomyStore(operator);

  // ── status ────────────────────────────────────────────────────────────────
  if (parsed.data.kind === "status") {
    const providers = await providerStatuses();
    const first = providers.find((p) => p.id === cfg.chatDefaultProvider && p.available)
      ?? providers.find((p) => p.available);

    return NextResponse.json({
      enabled: !!first,
      ...(first
        ? {}
        : {
            reason:
              "No model provider is configured on this deploy. Set one of OPENROUTER_API_KEY, ANTHROPIC_API_KEY or OPENAI_COMPATIBLE_BASE_URL in .env.local — or run the console locally, where a Claude Max subscription needs no key at all.",
          }),
      providers,
      defaultProviderId: first?.id ?? null,
      defaultModelId: first?.models[0]?.id ?? null,
      autonomy: {
        offerable: autonomy.offerable,
        ...(autonomy.reason ? { reason: autonomy.reason } : {}),
        active: autonomy.mode() === "full",
        perActionCapCents: autonomy.offerable ? cfg.autonomyMaxCents : null,
      },
      ceiling: await ceilingBlock(),
    });
  }

  // ── autonomy ──────────────────────────────────────────────────────────────
  //
  // Disabling is one call and needs nothing. Enabling is a 428 whose terms the
  // server composed and the browser echoes back unchanged. That asymmetry is
  // deliberate and matches the ceiling's: restraining yourself is one click,
  // and loosening is a thing you have to read.
  if (parsed.data.kind === "autonomy") {
    if (!parsed.data.enable) {
      autonomy.revoke();
      return NextResponse.json({ active: false, mode: "reads" });
    }

    if (!autonomy.offerable) {
      return fail("CONSOLE_AUTONOMY_UNAVAILABLE", { reason: autonomy.reason });
    }

    const capCents = await spendStore().cap();

    if (!parsed.data.confirm) {
      const challenge = autonomy.challenge(capCents);
      return fail("CONSOLE_AUTONOMY_CONFIRM_REQUIRED", { ...challenge });
    }

    const granted = autonomy.grant(parsed.data.confirm, capCents);
    if (!granted.ok) {
      // A fresh challenge rides along, so a stale acknowledgement — the ceiling
      // was tightened while the dialog was open — shows the operator the new
      // terms instead of a dead end.
      return fail("CONSOLE_AUTONOMY_CONFIRM_REQUIRED", {
        rejected: granted.reason,
        ...autonomy.challenge(capCents),
      });
    }

    return NextResponse.json({
      active: true,
      mode: "full",
      expiresAtMs: granted.grant.expiresAtMs,
      perActionCapCents: granted.grant.perActionCapCents,
    });
  }

  // ── turn ──────────────────────────────────────────────────────────────────
  const { provider, model, message, history } = parsed.data;

  if (!isProviderId(provider)) {
    return fail("CONSOLE_CHAT_PROVIDER_UNAVAILABLE", { provider });
  }

  const adapter = await adapterFor(provider);
  if (!adapter) {
    const status = (await providerStatuses()).find((p) => p.id === provider);
    return fail("CONSOLE_CHAT_PROVIDER_UNAVAILABLE", {
      provider,
      reason: status?.reason,
    });
  }

  const caps = await capabilities();
  // Asked once for the tool list the model is shown, and asked again by the
  // executor on every single call. Both matter: the first shapes what it will
  // reach for, the second is what actually decides.
  const mode = autonomy.mode();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);

  let events: ChatEvent[];
  try {
    events = await adapter.run(
      {
        model,
        system: systemPrompt({
          baseUrl: cfg.baseUrl,
          network: cfg.network,
          operator,
          mode,
          ceiling: await ceilingBlock().then((c) =>
            c.enabled ? { enabled: true, spentCents: c.spentCents, capCents: c.cap } : null,
          ),
          perActionCapCents: mode === "full" ? cfg.autonomyMaxCents : null,
        }),
        history: [...(history as ChatTurn[]), { role: "user", text: message }],
        tools: toolsFor(caps, mode),
        signal: controller.signal,
      },
      makeExecutor({
        origin: req,
        capabilities: caps,
        autonomy,
        secrets: providerSecrets(),
      }),
    );
  } catch (err) {
    // Redacted with the provider keys, because a provider SDK's error is the
    // single most likely place for one of them to surface — and this response
    // goes to a browser.
    return fail("CONSOLE_CHAT_PROVIDER_ERROR", {
      provider,
      reason: redact(err instanceof Error ? err.message : String(err), providerSecrets()) as string,
    });
  } finally {
    clearTimeout(timer);
  }

  return NextResponse.json(
    redact(
      {
        events,
        mode: autonomy.mode(),
        autonomy: { active: autonomy.mode() === "full" },
        ceiling: await ceilingBlock(),
      },
      providerSecrets(),
    ),
  );
}
