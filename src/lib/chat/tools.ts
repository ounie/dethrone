import type { Autonomy } from "../agent";
import type { Capabilities } from "../capability";
import { COMMANDS, byId, fieldsFor, type Command, type Field } from "../commands";
import type { ToolSpec } from "./types";

/**
 * The agent's tool surface, derived from the catalogue.
 *
 * ## Nothing here is written by hand
 *
 * A hand-maintained tool list is a second catalogue, and the day it disagrees
 * with the first one is the day the model reaches for a command that does not
 * exist and the operator reads a refusal that looks like a game rule. So every
 * tool is a `Command`, every parameter is a `Field`, and adding a command to
 * `commands.ts` adds a tool with no edit here.
 *
 * `test/chat-route.test.ts` asserts the bijection: one tool per enabled
 * command, no tool without a command, no command silently missing a tool.
 *
 * ## Why every parameter is a string
 *
 * `/api/act`'s body schema is `z.record(z.string(), z.string())` — every
 * argument arrives as a string and the route coerces it, because that is what a
 * form submits. Declaring `characterId` as a JSON-schema integer would let a
 * model send `12` where the route expects `"12"`, and the failure would land as
 * a malformed-request refusal three layers from the cause. The tool schema
 * describes the wire, not the domain, and the wire is strings.
 */

/** Tool names are prefixed so a model cannot confuse one with its own built-ins. */
const PREFIX = "dethrone_";

export function toolName(cmd: Command): string {
  return `${PREFIX}${cmd.id}`;
}

export function commandForTool(name: string): Command | undefined {
  if (!name.startsWith(PREFIX)) return undefined;
  return byId(name.slice(PREFIX.length));
}

function describeField(field: Field): string {
  const parts = [field.label];
  if (field.hint) parts.push(field.hint);
  if (field.kind === "actions") {
    parts.push("A JSON array of integer menu indices, in exchange order.");
  } else if (field.kind === "number") {
    parts.push("A whole number, sent as a string.");
  } else if (field.kind === "boolean") {
    parts.push('Either "true" or "false".');
  }
  return parts.join(" ");
}

export function parametersFor(cmd: Command): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const field of fieldsFor(cmd)) {
    const schema: Record<string, unknown> = {
      type: "string",
      description: describeField(field),
    };
    if (field.options) schema.enum = [...field.options];
    properties[field.name] = schema;
    if (!field.optional) required.push(field.name);
  }

  return { type: "object", properties, required, additionalProperties: false };
}

/**
 * The description the model reads. Assembled from the catalogue's own words.
 *
 * `cmd.price` is a **label**, and it is passed through verbatim rather than
 * formatted here, because formatting it would mean this module holds an opinion
 * about money. The live figure comes from `GET /api/rules` and reaches the
 * model, when it matters, in the 428 the executor surfaces — not from here.
 */
function describeTool(cmd: Command, mode: Autonomy): string {
  const parts = [`${cmd.method} ${cmd.path} — ${cmd.label}.`];
  if (cmd.note) parts.push(cmd.note);

  if (cmd.tier === "free") {
    parts.push("Free: no wallet, no signature, nothing at stake. Call it whenever it helps.");
  } else if (cmd.tier === "signed") {
    parts.push(`Signed: proves the operator's wallet. Costs ${cmd.price}.`);
  } else {
    parts.push(`Paid: settles ${cmd.price} in USDC the moment the arena's handler succeeds.`);
  }

  if (cmd.destructive) {
    parts.push(
      "DESTRUCTIVE and irreversible. It is always the operator's click, never yours, in any mode.",
    );
  } else if (cmd.tier !== "free" && mode !== "full") {
    // Told, rather than discovered. A model that learns the rule from a refusal
    // spends a round of the loop learning it, and some models spend several.
    parts.push(
      "PROPOSAL ONLY in the current mode: calling this asks the operator to run it and returns" +
        " immediately. It does not act, and nothing is signed or spent. Call it when you want to" +
        " propose the action, and say why in your reply.",
    );
  }

  return parts.join(" ");
}

/**
 * The tools this deploy can actually offer, in this mode.
 *
 * Disabled commands are omitted entirely rather than offered-and-refused. The
 * verdicts are `lib/registry.ts`'s — the same ones the rail renders — so the
 * model's menu and the operator's menu cannot disagree.
 */
export function toolsFor(caps: Capabilities, mode: Autonomy): ToolSpec[] {
  return COMMANDS.filter((cmd) => caps[cmd.id]?.enabled !== false).map((cmd) => ({
    name: toolName(cmd),
    description: describeTool(cmd, mode),
    parameters: parametersFor(cmd),
  }));
}
