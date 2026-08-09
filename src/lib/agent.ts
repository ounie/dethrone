/**
 * What the agent is, decided on the server and shipped to the browser as data.
 *
 * This file exists for exactly the reason `capability.ts` does, and the argument
 * is worth repeating because it is the thing that keeps the trust boundary
 * intact: the chat pane needs these shapes, and the modules that *produce* them
 * read provider keys. If the pane imported the type from the provider registry,
 * there would be an edge in the import graph from a client component to a module
 * holding a credential — erased at compile time, harmless at runtime, and one
 * refactor away from being real.
 *
 * So: types here, keys elsewhere, and `test/deps.test.ts` asserts the edge does
 * not exist.
 *
 * **Nothing in this file may hold a value.** No default model, no provider list,
 * no cap. Every number and every sentence the pane renders was computed by the
 * server and handed over, which is the same rule the rest of this console
 * follows and the reason the browser can be trusted with none of the decisions.
 */

/** The four backends. A closed union — a fifth is a deliberate edit here. */
export type ProviderId = "claude-max" | "openrouter" | "anthropic" | "openai-compatible";

export interface ModelChoice {
  id: string;
  label: string;
}

export interface ChatProvider {
  id: ProviderId;
  label: string;
  available: boolean;
  /**
   * Rendered verbatim beside an unavailable provider, never inferred.
   *
   * "This deploy holds no key for it" and "the Claude Agent SDK needs a machine
   * to spawn a subprocess on" are facts about the server. A browser that guessed
   * at them would eventually guess wrong in the reassuring direction.
   */
  reason?: string;
  models: readonly ModelChoice[];
  /**
   * Set when the live catalogue could not be fetched. The picker degrades to a
   * free-text model id and shows this — deliberately, rather than rendering an
   * empty dropdown that looks like the provider has no models.
   */
  modelsReason?: string;
}

export interface AutonomyOffer {
  /** Whether "full autonomy" may be turned on here at all. */
  offerable: boolean;
  /** Why not. Rendered verbatim beside the disabled toggle. */
  reason?: string;
  /** Live now. The server owns this; the client renders it and cannot set it. */
  active: boolean;
  /** The most one autonomous action may cost. Formatted by `money()` for display. */
  perActionCapCents: number | null;
}

export interface AgentConfig {
  /** False when no provider can run here. The pane renders disabled with the reason. */
  enabled: boolean;
  reason?: string;
  providers: readonly ChatProvider[];
  defaultProviderId: ProviderId | null;
  defaultModelId: string | null;
  autonomy: AutonomyOffer;
}

/**
 * The two modes.
 *
 * `reads` — the agent runs the free reads and nothing else. Anything that would
 * sign or spend comes back as a PROPOSAL, which the operator approves (issuing
 * it through the same guarded route the Run button uses) or loads into the
 * command pane to edit first. Approving a paid one still earns the 428 and the
 * confirmation dialog: the mode decides who may act, never what a payment costs
 * or whether it is announced.
 *
 * `full` — the agent may also sign and pay, bounded by the per-action cap, the
 * sitting ceiling, and the offer gate. Requires a server-held grant; this string
 * is a *rendering* of that grant, never an instruction that creates one.
 */
export type Autonomy = "reads" | "full";

/** What the server asks the browser to echo back before granting full autonomy. */
export interface AutonomyChallenge {
  operator: string;
  perActionCapCents: number;
  capCents: number;
  expiresInMs: number;
  /** The sentence the server composed. Echoed back unchanged, or the grant fails. */
  acknowledgement: string;
  /** Single use. Minted by the server, consumed on grant. */
  nonce: string;
}

// ── The transcript ──────────────────────────────────────────────────────────
//
// Held by the browser, because the console persists nothing. The server
// re-reads it each turn and never re-executes it.

export interface ToolRecord {
  commandId: string;
  method: string;
  path: string;
  args: Record<string, string>;
  status: number | string | null;
  ms: number | null;
  settled: boolean;
  /** The console's or the arena's own code. Never a sentence invented here. */
  errorCode?: string;
  /** Present when an autonomous action was priced: the terms the server computed. */
  terms?: { amountCents: number; payer: string };
}

export interface Proposal {
  commandId: string;
  args: Record<string, string>;
  /** The agent's own reason for wanting this. Rendered as its words, not ours. */
  why: string;
}

export type Turn =
  | { kind: "you"; at: string; text: string }
  | { kind: "agent"; at: string; text: string; pending?: boolean }
  | { kind: "tool"; at: string; record: ToolRecord }
  | { kind: "proposal"; at: string; proposal: Proposal; loaded?: boolean }
  | { kind: "refusal"; at: string; code: string; detail?: string };

/**
 * One event as it arrives on the wire from `/api/chat`.
 *
 * A structural mirror of `lib/chat/types.ts`'s `ChatEvent`, declared separately
 * rather than imported — for the same reason this whole file exists. That
 * module is reachable from the executor, which is reachable from the wallet, and
 * `test/deps.test.ts` fails on an import edge from a component to anything that
 * can see a key. Two declarations of one shape is the price of the boundary, and
 * the shape is small and changes rarely.
 */
export type ChatEventWire =
  | { type: "text"; text: string }
  | {
      type: "executed";
      tool: string;
      commandId: string;
      method: string;
      path: string;
      args: Record<string, string>;
      status: number | string | null;
      ms: number | null;
      settled: boolean;
      errorCode?: string;
      terms?: { amountCents: number; payer: string };
      /** The redacted envelope, for the response pane. */
      body?: unknown;
    }
  | {
      type: "proposal";
      tool: string;
      commandId: string;
      args: Record<string, string>;
      why: string;
    }
  | { type: "refused"; tool?: string; code: string; detail?: string };
