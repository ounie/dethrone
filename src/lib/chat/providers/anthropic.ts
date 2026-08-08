import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ModelChoice } from "../../agent";
import {
  MAX_TOOL_ROUNDS,
  type ChatEvent,
  type ProviderRunInput,
  type ToolExecutor,
} from "../types";
import { cachedModels, requireEnv, type ProviderModule } from "./registry";

/**
 * The Anthropic API, on an API key, billed separately from any subscription.
 *
 * The manual tool loop rather than the SDK's tool runner, and the reason is the
 * shape of this application rather than a preference: the runner executes tool
 * functions on its own, and the one thing that must be true here is that every
 * tool call passes through `makeExecutor`'s gate — the tier check, the grant
 * re-read, the single confirmation echo. Handing that responsibility to a helper
 * would mean the guarantee lives in a library's control flow instead of in a
 * function this repo can point at and test.
 *
 * This file is the **only** place `@anthropic-ai/sdk` is imported, and
 * `test/chat-route.test.ts` pins that. The SDK's own network calls are
 * invisible to `test/one-fetch.test.ts`, which walks `src/` only, so uniqueness
 * of the import is the substitute for an exemption entry it cannot see.
 */

/** Adaptive thinking, no sampling parameters — the current-generation contract. */
const MAX_TOKENS = 8_192;

function client(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim() });
}

async function loadModels(): Promise<ModelChoice[]> {
  const out: ModelChoice[] = [];
  for await (const model of client().models.list()) {
    out.push({ id: model.id, label: model.display_name ?? model.id });
  }
  return out;
}

type Block = Anthropic.ContentBlockParam;

async function run(input: ProviderRunInput, execute: ToolExecutor): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  const anthropic = client();

  const messages: Anthropic.MessageParam[] = input.history.map((turn) => {
    if (turn.role === "user") return { role: "user", content: turn.text };
    if (turn.role === "assistant") {
      const blocks: Block[] = [];
      if (turn.text) blocks.push({ type: "text", text: turn.text });
      for (const c of turn.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args });
      }
      return { role: "assistant", content: blocks };
    }
    return {
      role: "user",
      content: turn.results.map(
        (r): Block => ({
          type: "tool_result",
          tool_use_id: r.id,
          content: r.content,
          ...(r.isError ? { is_error: true } : {}),
        }),
      ),
    };
  });

  const tools: Anthropic.Tool[] = input.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
  }));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create(
      {
        model: input.model,
        max_tokens: MAX_TOKENS,
        system: input.system,
        thinking: { type: "adaptive" },
        messages,
        tools,
      },
      { signal: input.signal },
    );

    // A refusal is a content outcome, not an exception, and reading content[0]
    // without checking is how that surfaces as a confusing crash instead.
    if (response.stop_reason === "refusal") {
      events.push({
        type: "text",
        text: "The model declined to answer that. Nothing was sent to the arena.",
      });
      return events;
    }

    for (const block of response.content) {
      if (block.type === "text" && block.text) events.push({ type: "text", text: block.text });
    }

    const calls = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (calls.length === 0) return events;

    messages.push({ role: "assistant", content: response.content as Block[] });

    const results: Block[] = [];
    // Sequentially. See openai-shape.ts for why.
    for (const call of calls) {
      const outcome = await execute({
        id: call.id,
        name: call.name,
        args: (call.input ?? {}) as Record<string, unknown>,
      });
      events.push(outcome.event);
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: outcome.toolResult.content,
        ...(outcome.toolResult.isError ? { is_error: true } : {}),
      });
    }

    // All results in ONE user message. Splitting them across several trains the
    // model to stop making parallel calls.
    messages.push({ role: "user", content: results });
  }

  events.push({
    type: "text",
    text: "I stopped after the maximum number of tool calls for one turn. Ask me to continue if that was not enough.",
  });
  return events;
}

export const provider: ProviderModule = {
  id: "anthropic",

  unavailable(env) {
    return requireEnv(env, ["ANTHROPIC_API_KEY"], "The Anthropic API");
  },

  models() {
    return cachedModels("anthropic", loadModels);
  },

  async adapter() {
    return { id: "anthropic", run };
  },
};
