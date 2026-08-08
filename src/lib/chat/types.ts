import type { ConsoleErrorCode } from "../errors";

/**
 * The vocabulary the four provider adapters share.
 *
 * Pure types, no `server-only`: nothing here holds a value, and the executor's
 * tests import it. The point of this file is that a provider adapter speaks
 * *this* and not OpenAI's shape or Anthropic's — the translation happens at the
 * edge of each adapter, so the tool loop and the tier gate are written once.
 *
 * ## v1 is not streamed
 *
 * `run()` returns a settled array of events, one envelope per turn, exactly as
 * `/api/act` returns one envelope per command. Streaming would need a second
 * serialisation format on the wire and a second way for the client to learn
 * that a tool executed, and the second way is where the two would disagree.
 * It is a follow-up, not a missing piece.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema. Every property is a string — see `tools.ts` for why. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  /** Already redacted, already capped. What the model is allowed to read. */
  content: string;
  isError?: boolean;
}

/** A turn as the adapters exchange it. The browser's `Turn` is a different, richer shape. */
export type ChatTurn =
  | { role: "user"; text: string }
  | { role: "assistant"; text?: string; toolCalls?: ToolCall[] }
  | { role: "tool"; results: ToolResult[] };

/**
 * What the operator is shown. One tool call produces exactly one of `executed`,
 * `proposal` or `refused` — never two, and never none.
 */
export type ChatEvent =
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
      /** The amount and payer `/api/act` computed, when it priced one. */
      terms?: { amountCents: number; payer: string };
      /**
       * The redacted envelope, for the response pane — so a tool call the agent
       * made is inspectable exactly like a command the operator clicked.
       *
       * This travels to the BROWSER only. What the model reads is
       * `toolResult.content`, which is the same envelope capped in length. The
       * two are separate fields because they have different audiences and
       * different limits, and conflating them is how a 40 KB arena body ends up
       * being billed as context.
       */
      body?: unknown;
    }
  | {
      type: "proposal";
      tool: string;
      commandId: string;
      args: Record<string, string>;
      why: string;
    }
  | { type: "refused"; tool?: string; code: ConsoleErrorCode; detail?: string };

/**
 * The one function that stands between a model's intention and the arena.
 *
 * Every adapter is handed the same closure. It is the only thing they can do
 * that has an effect, and it is where the tier gate, the autonomy grant and the
 * confirmation echo live — so no adapter can skip a guard by being written
 * differently from the others.
 */
export type ToolExecutor = (call: ToolCall) => Promise<ToolOutcome>;

export interface ToolOutcome {
  /** Handed back to the model. */
  toolResult: ToolResult;
  /** Handed to the operator. */
  event: ChatEvent;
}

export interface ProviderRunInput {
  model: string;
  system: string;
  history: readonly ChatTurn[];
  tools: readonly ToolSpec[];
  signal: AbortSignal;
}

export interface ChatProviderAdapter {
  readonly id: string;
  run(input: ProviderRunInput, execute: ToolExecutor): Promise<ChatEvent[]>;
}

/**
 * How many times one turn may go round the tool loop.
 *
 * Not a safety bound — the tier gate and the ceiling are the safety bounds, and
 * they hold at every round. This stops a model that has decided to keep reading
 * the seat forever from doing it on the operator's clock.
 */
export const MAX_TOOL_ROUNDS = 8;

/** How long one turn may take, wall-clock, including every tool call in it. */
export const TURN_TIMEOUT_MS = 120_000;

/**
 * The most of one arena response a tool result may carry.
 *
 * A `GET /api/arenas` body is larger than some context windows, and a truncated
 * read the model can see is worth more than a turn that dies. Truncation is
 * announced in the result rather than done silently — a model that cannot tell
 * it got half an answer will confidently report on the half it got.
 */
export const MAX_TOOL_RESULT_BYTES = 8_000;
