import "server-only";
import type { ModelChoice } from "../../agent";
import {
  MAX_TOOL_ROUNDS,
  type ChatEvent,
  type ProviderRunInput,
  type ToolCall,
  type ToolExecutor,
} from "../types";

/**
 * The OpenAI chat-completions shape, which OpenRouter and every "compatible"
 * endpoint speak.
 *
 * One implementation, two providers. The only differences between them are a
 * base URL, a label and whether the model catalogue is worth showing, and
 * writing the tool loop twice to express that would be writing the tool loop
 * twice.
 *
 * ## Why plain `fetch` and not a client library
 *
 * Deliberate. `test/one-fetch.test.ts` walks the AST of everything under `src/`
 * looking for `fetch` call sites that do not target this console's own routes,
 * and it finds these two — which means they must be named in that test's
 * exemption list with a stated reason, and a third outbound destination cannot
 * be added without a reviewer seeing it. A client library would hide the same
 * call inside `node_modules`, where the scan cannot reach. The visible call is
 * the feature.
 */

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface Completion {
  choices?: { message?: OpenAiMessage; finish_reason?: string }[];
  error?: { message?: string };
}

export interface OpenAiShapeConfig {
  baseUrl: string;
  apiKey: string;
  /** Sent by OpenRouter for attribution; harmless elsewhere. */
  headers?: Record<string, string>;
  label: string;
}

function endpoint(baseUrl: string, path: string): string {
  const root = baseUrl.replace(/\/+$/, "");
  // Accept a base URL with or without /v1, because both are in the wild and
  // getting it wrong produces a 404 that reads like an outage.
  return /\/v\d+$/.test(root) ? `${root}${path}` : `${root}/v1${path}`;
}

export async function loadOpenAiModels(cfg: OpenAiShapeConfig): Promise<ModelChoice[]> {
  const res = await fetch(endpoint(cfg.baseUrl, "/models"), {
    headers: { authorization: `Bearer ${cfg.apiKey}`, ...cfg.headers },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${cfg.label} answered ${res.status}`);

  const json = (await res.json()) as { data?: { id?: string; name?: string }[] };
  return (json.data ?? [])
    .filter((m): m is { id: string; name?: string } => typeof m.id === "string")
    // `id` and `name` only. OpenRouter also publishes a `pricing` block, and it
    // is dropped here on purpose: this console does no token accounting, and
    // carrying a price through would put a second currency on a screen whose
    // entire colour argument rests on there being one.
    .map((m) => ({ id: m.id, label: m.name ?? m.id }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // A model that emits malformed JSON gets a local refusal from the executor
    // rather than a crashed turn; an empty object reliably fails the route's
    // required-field check and comes back as CONSOLE_MISSING_FIELD.
    return {};
  }
}

export async function runOpenAiShape(
  cfg: OpenAiShapeConfig,
  input: ProviderRunInput,
  execute: ToolExecutor,
): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];

  const messages: OpenAiMessage[] = [
    { role: "system", content: input.system },
    ...input.history.map((turn): OpenAiMessage => {
      if (turn.role === "user") return { role: "user", content: turn.text };
      if (turn.role === "assistant") {
        return {
          role: "assistant",
          content: turn.text ?? null,
          ...(turn.toolCalls?.length
            ? {
                tool_calls: turn.toolCalls.map((c) => ({
                  id: c.id,
                  type: "function" as const,
                  function: { name: c.name, arguments: JSON.stringify(c.args) },
                })),
              }
            : {}),
        };
      }
      // A tool turn carries results for the calls in the assistant turn before
      // it; the shape wants one message per result.
      return { role: "tool", content: turn.results[0]?.content ?? "", tool_call_id: turn.results[0]?.id };
    }),
  ];

  const tools = input.tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(endpoint(cfg.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        "content-type": "application/json",
        ...cfg.headers,
      },
      body: JSON.stringify({ model: input.model, messages, tools, tool_choice: "auto" }),
      signal: input.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${cfg.label} answered ${res.status}: ${text.slice(0, 400)}`);
    }

    const json = (await res.json()) as Completion;
    if (json.error?.message) throw new Error(`${cfg.label}: ${json.error.message}`);

    const message = json.choices?.[0]?.message;
    if (!message) throw new Error(`${cfg.label} returned no message`);

    if (message.content) events.push({ type: "text", text: message.content });

    const calls = message.tool_calls ?? [];
    if (calls.length === 0) return events;

    messages.push({
      role: "assistant",
      content: message.content ?? null,
      tool_calls: calls,
    });

    // Sequentially, not in parallel. Two paid commands racing would both pass a
    // ceiling check only one should — the store reserves before the request for
    // exactly that reason, and there is no need to lean on it here as well.
    for (const raw of calls) {
      const call: ToolCall = {
        id: raw.id,
        name: raw.function.name,
        args: parseArgs(raw.function.arguments),
      };
      const outcome = await execute(call);
      events.push(outcome.event);
      messages.push({
        role: "tool",
        tool_call_id: raw.id,
        name: raw.function.name,
        content: outcome.toolResult.content,
      });
    }
  }

  events.push({
    type: "text",
    text: "I stopped after the maximum number of tool calls for one turn. Ask me to continue if that was not enough.",
  });
  return events;
}
