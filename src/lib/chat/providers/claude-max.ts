import "server-only";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { z } from "zod";
import type { ModelChoice } from "../../agent";
import { TURN_TIMEOUT_MS, type ChatEvent, type ProviderRunInput, type ToolExecutor } from "../types";
import { subprocessImpossible, type ProviderModule } from "./registry";

/**
 * Claude on the operator's own Max or Pro subscription.
 *
 * ## The only provider that asks for no key, and the only one that cannot run everywhere
 *
 * Those are the same fact. A Claude subscription cannot be used over the raw
 * Messages API — there is no key to issue and no header to send. What can use it
 * is `@anthropic-ai/claude-agent-sdk`, which is Claude Code packaged as a
 * library: it spawns a local `claude` process, and that process resolves the
 * credentials the operator already has from Claude Code or `ant auth login`.
 *
 * So the subscription pays, nothing in this repo ever holds a credential for
 * it, and there is correspondingly nothing to leak. The cost is that it needs a
 * machine to spawn a process on and credentials on disk to inherit, which a
 * serverless invocation has neither of. On such a deploy this provider renders
 * unavailable with that sentence, rather than failing at the first message.
 *
 * ## What the subprocess is allowed to do
 *
 * Almost nothing. `allowedTools` names only the tools this console provides,
 * so the harness's own Bash, Read, Write, Edit, Glob, Grep, WebSearch and
 * WebFetch are all off. That matters more here than with the other three
 * providers: this one runs on the operator's machine with the operator's
 * credentials, and a coding agent's default toolset on a wallet-holding host is
 * a much larger surface than the arena.
 *
 * The tools it does get are an in-process MCP server whose handlers call the
 * same `ToolExecutor` every other provider is handed — so the tier gate, the
 * grant and the confirmation echo apply identically. The SDK is never given the
 * arena's URL, a wallet, or the `@dethrone/mcp` package: an agent talking
 * straight to the arena's own MCP server would pay outside this console's
 * ceiling, which is the one thing this whole design exists to prevent.
 *
 * This file is the only place `@anthropic-ai/claude-agent-sdk` is imported, and
 * `test/chat-route.test.ts` pins that.
 */

/**
 * The SDK publishes no model catalogue, so this list is written here — the one
 * place in this feature where a list is hand-held rather than fetched.
 *
 * It is honest about being a convenience: the picker degrades to a free-text
 * model id, and an id typed there is passed through untouched. A model released
 * after this line was written is usable the day it ships.
 */
const KNOWN_MODELS: ModelChoice[] = [
  // First entry is the default the picker selects. Sonnet: this is a console
  // that reads an API and reports what it says, which Sonnet does well and
  // quickly, and a turn here is measured against a person waiting rather than
  // against a benchmark. Opus is one click away for anything that needs it.
  { id: "sonnet", label: "Claude Sonnet (latest)" },
  { id: "opus", label: "Claude Opus (latest)" },
  { id: "haiku", label: "Claude Haiku (latest)" },
  { id: "claude-opus-4-5", label: "Claude Opus 4.5" },
];

const MCP_SERVER = "dethrone";

/**
 * A zod shape from a tool's JSON schema.
 *
 * Every property is a string — see `chat/tools.ts` for why — so this is a
 * mechanical translation rather than a schema compiler, and it stays that way
 * on purpose. The moment it needs to handle a second type, the tool schema and
 * the route's body schema have drifted apart and that is the bug to fix.
 */
function shapeFor(parameters: Record<string, unknown>): z.ZodRawShape {
  const props = (parameters.properties ?? {}) as Record<string, { description?: string }>;
  const required = new Set((parameters.required ?? []) as string[]);

  const shape: Record<string, z.ZodType> = {};
  for (const [name, prop] of Object.entries(props)) {
    const base = z.string().describe(prop.description ?? name);
    shape[name] = required.has(name) ? base : base.optional();
  }
  return shape as z.ZodRawShape;
}

async function run(input: ProviderRunInput, execute: ToolExecutor): Promise<ChatEvent[]> {
  const { createSdkMcpServer, query, tool } = await import("@anthropic-ai/claude-agent-sdk");

  const events: ChatEvent[] = [];

  const tools = input.tools.map((spec) =>
    tool(spec.name, spec.description, shapeFor(spec.parameters), async (args) => {
      const outcome = await execute({
        id: `${spec.name}_${events.length}`,
        name: spec.name,
        args: args as Record<string, unknown>,
      });
      events.push(outcome.event);
      return {
        content: [{ type: "text" as const, text: outcome.toolResult.content }],
        isError: outcome.toolResult.isError,
      };
    }),
  );

  // The transcript, flattened. The SDK owns its own conversation state, so the
  // history is replayed as context rather than as structured turns — a turn
  // this console re-executed would be a second payment for one command.
  const transcript = input.history
    .map((turn) => {
      if (turn.role === "user") return `Operator: ${turn.text}`;
      if (turn.role === "assistant") return turn.text ? `You: ${turn.text}` : "";
      return turn.results.map((r) => `Tool result: ${r.content}`).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");

  const allowed = input.tools.map((t) => `mcp__${MCP_SERVER}__${t.name}`);

  const response = query({
    prompt: transcript,
    options: {
      model: input.model,
      systemPrompt: { type: "preset", preset: "claude_code", append: input.system },
      mcpServers: {
        [MCP_SERVER]: createSdkMcpServer({ name: MCP_SERVER, version: "1.0.0", tools }),
      },
      /**
       * The subscription, and only the subscription.
       *
       * The subprocess inherits this process's environment and resolves
       * credentials in Claude Code's own order — `ANTHROPIC_API_KEY` first, the
       * logged-in OAuth session much later. So on a console that also has
       * `ANTHROPIC_API_KEY` set (which is exactly what enables the *Anthropic
       * API* provider three entries down the picker) this provider would
       * silently bill the API while the UI said "Max / Pro subscription".
       *
       * Stripping the two key variables makes the label true by construction:
       * pick this provider and your subscription pays, or it does not run at
       * all. The alternative — reporting whichever credential happened to win —
       * would make the picker's two Claude entries the same thing wearing
       * different names, which is the sort of ambiguity a money screen cannot
       * afford.
       */
      env: withoutApiKeys(process.env),

      /**
       * The console's tools, and nothing else. No filesystem, no shell, no web.
       *
       * `allowedTools` is deliberately EMPTY, and the names live in the callback
       * instead. The SDK warns — `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` — that a
       * bare name in `allowedTools` auto-approves the tool *before*
       * `canUseTool` is consulted, so listing them there would have made the
       * callback dead code for every tool it was written to allow. The
       * allowlist still worked, but by a mechanism other than the one the code
       * claimed, and a guard nobody can see running is a guard nobody will
       * notice breaking.
       *
       * One gate, and it is the callback.
       */
      allowedTools: [],
      disallowedTools: [
        "Bash",
        "Read",
        "Write",
        "Edit",
        "NotebookEdit",
        "Glob",
        "Grep",
        "WebSearch",
        "WebFetch",
        "Task",
      ],
      /**
       * An explicit allowlist, and NOT `permissionMode: "bypassPermissions"`.
       *
       * The SDK is Claude Code, so it expects a human at a terminal to approve
       * tool calls. There is nobody there: this runs inside a web request, and
       * an unanswered prompt is a turn that reports it could not read the seat.
       *
       * The tempting fix is to bypass permissions wholesale. This does not,
       * because the two mechanisms guard different things and only one of them
       * is redundant here. The console's own gate — the tier check, the grant,
       * the confirmation echo — has already run by the time a tool executes, so
       * a second prompt in front of `dethrone_*` asks a question that was
       * already answered. It has answered nothing about `Bash`. So the callback
       * says yes to exactly the tools this console generated and no to
       * everything else, by name, and a tool the SDK adds in a future version
       * is denied by default rather than inherited.
       */
      canUseTool: async (toolName) =>
        allowed.includes(toolName)
          ? // No `updatedInput`: passing one REPLACES the model's arguments, and
            // an empty object would blank every field before the executor saw it.
            { behavior: "allow" }
          : {
              behavior: "deny",
              message: `${toolName} is not available in the Dethrone Console. Only the arena's own commands are.`,
            },
      abortController: abortFrom(input.signal),
      maxTurns: 8,
    },
  });

  for await (const message of response) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text" && block.text) events.push({ type: "text", text: block.text });
      }
      if (message.error) throw sessionError(message.error);
    } else if (message.type === "result" && message.subtype !== "success") {
      throw new Error(`The local Claude session ended: ${message.subtype}`);
    }
  }

  return events;
}

/**
 * Is the `claude` binary reachable from this process?
 *
 * Walks `PATH` rather than shelling out to `which`, because this runs on the
 * availability path — rendering a picker must not spawn a process, and a check
 * that costs a fork is a check somebody eventually caches wrongly.
 *
 * Worth knowing why this can fail on a machine where `claude` obviously works:
 * a dev server inherits the `PATH` of whatever launched it. Started from your
 * shell, an nvm-installed `claude` is there. Started from a GUI app, a
 * launchd job, or an editor's integrated terminal with a trimmed environment,
 * it may not be — and the honest answer then is "this process cannot see it",
 * not "you do not have it".
 */
function claudeOnPath(env: NodeJS.ProcessEnv): boolean {
  const path = env.PATH ?? env.Path;
  if (!path) return false;
  const names = process.platform === "win32" ? ["claude.cmd", "claude.exe", "claude"] : ["claude"];

  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      try {
        accessSync(join(dir, name), constants.X_OK);
        return true;
      } catch {
        // Next candidate.
      }
    }
  }
  return false;
}

/**
 * Whether you are *logged in* is deliberately not checked here.
 *
 * It is knowable — the credential is in the OS keychain on macOS — and reading
 * it would be the wrong thing for this module to do. A console that reaches
 * into your keychain to find out something it could simply be told has quietly
 * become a thing that reads your keychain, and on some setups that pops an OS
 * prompt for a UI render.
 *
 * So the session is discovered the way everything else here is discovered: by
 * asking and rendering the refusal. The SDK reports `authentication_failed`,
 * and `run()` turns that into a sentence naming `claude login`.
 */

/**
 * The environment the subprocess gets: this one, minus anything that would
 * make it authenticate as an API key rather than as the operator's session.
 *
 * `ANTHROPIC_AUTH_TOKEN` is stripped alongside `ANTHROPIC_API_KEY` because it
 * sits *above* the OAuth profile in the same resolution order and would win in
 * exactly the same silent way.
 */
function withoutApiKeys(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === "ANTHROPIC_API_KEY" || k === "ANTHROPIC_AUTH_TOKEN") continue;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * The SDK's error codes, said in words, with the fix where there is one.
 *
 * `authentication_failed` is the one that matters and the reason this function
 * exists: it is what a console that never asked you to log in looks like when
 * you have not. The generic message — "the local Claude session failed:
 * authentication_failed" — is technically accurate and useless, because the
 * thing the operator needs is the command to run.
 */
function sessionError(code: string): Error {
  switch (code) {
    case "authentication_failed":
      return new Error(
        "Not signed in to Claude on this machine. The console never asks you to authenticate — it borrows the session you already hold, so the credential stays yours. Run `claude login` in a terminal, then send this again.",
      );
    case "oauth_org_not_allowed":
      return new Error(
        "Your Claude organisation does not permit this. Signing in with a personal Max or Pro account, or asking an admin to allow it, is the way through.",
      );
    case "billing_error":
      return new Error(
        "Claude reported a billing problem with the signed-in account. Check the subscription is active.",
      );
    case "rate_limit":
      return new Error("Your Claude plan is rate-limited right now. Nothing was sent to the arena.");
    default:
      return new Error(`The local Claude session failed: ${code}`);
  }
}

/** The SDK wants an AbortController; the rest of this feature passes signals. */
function abortFrom(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", () => controller.abort(), { once: true });
  // A local subprocess with no upstream rate limit still needs an outer bound.
  setTimeout(() => controller.abort(), TURN_TIMEOUT_MS).unref?.();
  return controller;
}

export const provider: ProviderModule = {
  id: "claude-max",

  unavailable(env) {
    if (env.CONSOLE_CHAT_DISABLE_SUBPROCESS?.trim()) {
      return "Disabled on this deploy by CONSOLE_CHAT_DISABLE_SUBPROCESS.";
    }
    if (subprocessImpossible(env)) {
      return "A Claude Max or Pro subscription works on LOCAL RUNS ONLY. It drives a `claude` subprocess and inherits credentials from your own machine, and a hosted deploy has neither a process to spawn nor credentials to inherit. On Vercel or any other host, use an LLM provider API key instead — set OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or an OpenAI-compatible base URL and key.";
    }
    if (!claudeOnPath(env)) {
      return "This process cannot find the `claude` binary on its PATH. Install Claude Code and run `claude login`, or restart the console from a shell where `claude` resolves — a dev server started from a GUI app often inherits a trimmed PATH.";
    }
    return null;
  },

  async models() {
    return { models: KNOWN_MODELS };
  },

  async adapter() {
    return { id: "claude-max", run };
  },
};
