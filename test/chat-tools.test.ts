import { describe, expect, it } from "vitest";
import type { Capabilities } from "@/lib/capability";
import { COMMANDS, fieldsFor, isCallerPriced } from "@/lib/commands";
import { commandForTool, parametersFor, toolName, toolsFor } from "@/lib/chat/tools";

/**
 * The agent's tool surface is derived, not written.
 *
 * This file is the pin on that claim, and it is deliberately written over the
 * WHOLE catalogue rather than over a handful of interesting commands. A test
 * that checks three tools tells you nothing on the day someone adds a fourth
 * command with a field shape nobody anticipated — which is exactly the day the
 * model reaches for a tool whose schema does not match the route's expectations
 * and the operator reads a `CONSOLE_BAD_FIELD` that looks like a game rule.
 */

/** Every command enabled, which is what a keyed boot against a healthy arena gives. */
const ALL_ENABLED: Capabilities = Object.fromEntries(
  COMMANDS.map((c) => [c.id, { enabled: true }]),
);

/** A keyless boot: free commands only, everything else disabled with a reason. */
const KEYLESS: Capabilities = Object.fromEntries(
  COMMANDS.map((c) => [
    c.id,
    c.tier === "free" ? { enabled: true } : { enabled: false, reason: "Read-only." },
  ]),
);

describe("the tool surface is the catalogue", () => {
  it("offers exactly one tool per enabled command", () => {
    const tools = toolsFor(ALL_ENABLED, "reads");
    expect(tools).toHaveLength(COMMANDS.length);
  });

  it("has no tool that does not map back to a command", () => {
    const orphans = toolsFor(ALL_ENABLED, "reads")
      .filter((t) => commandForTool(t.name) === undefined)
      .map((t) => t.name);
    expect(orphans, `these tools name no command: ${orphans.join(", ")}`).toEqual([]);
  });

  it("leaves no enabled command without a tool", () => {
    const names = new Set(toolsFor(ALL_ENABLED, "reads").map((t) => t.name));
    const missing = COMMANDS.filter((c) => !names.has(toolName(c))).map((c) => c.id);
    expect(missing, `these commands have no tool: ${missing.join(", ")}`).toEqual([]);
  });

  it("gives every tool a unique name", () => {
    const names = toolsFor(ALL_ENABLED, "reads").map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("refuses a tool name that is not one of ours", () => {
    // A model that invents `get_weather` must land on a local refusal, not on a
    // catalogue lookup that happens to hit.
    expect(commandForTool("get_weather")).toBeUndefined();
    expect(commandForTool("seat")).toBeUndefined();
    expect(commandForTool("dethrone_not_a_command")).toBeUndefined();
  });

  it("omits disabled commands entirely rather than offering them to be refused", () => {
    const tools = toolsFor(KEYLESS, "reads");
    const free = COMMANDS.filter((c) => c.tier === "free");
    expect(tools).toHaveLength(free.length);
    expect(free.length).toBeGreaterThan(20);

    const offered = tools.map((t) => commandForTool(t.name)!.tier);
    expect(new Set(offered)).toEqual(new Set(["free"]));
  });
});

describe("every parameter describes the wire, which is strings", () => {
  for (const cmd of COMMANDS) {
    it(`${cmd.id} declares only string parameters`, () => {
      const schema = parametersFor(cmd) as {
        type: string;
        properties: Record<string, { type: string; description?: string; enum?: string[] }>;
        required: string[];
        additionalProperties: boolean;
      };

      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);

      for (const [name, prop] of Object.entries(schema.properties)) {
        // `/api/act` parses the body as z.record(z.string(), z.string()). A
        // JSON-schema integer here would let a model send 12 where the route
        // expects "12".
        expect(prop.type, `${cmd.id}.${name} is not a string`).toBe("string");
        expect(prop.description?.length ?? 0).toBeGreaterThan(0);
      }
    });

    it(`${cmd.id} exposes exactly the fields the route reads`, () => {
      const schema = parametersFor(cmd) as {
        properties: Record<string, unknown>;
        required: string[];
      };
      const expected = fieldsFor(cmd).map((f) => f.name);
      expect(Object.keys(schema.properties).sort()).toEqual([...expected].sort());

      const requiredExpected = fieldsFor(cmd)
        .filter((f) => !f.optional)
        .map((f) => f.name);
      expect(schema.required.sort()).toEqual(requiredExpected.sort());
    });
  }

  it("carries a select field's options through as an enum", () => {
    const withOptions = COMMANDS.filter((c) =>
      (c.fields ?? []).some((f) => f.kind === "select" && f.options),
    );
    expect(withOptions.length).toBeGreaterThan(0);

    for (const cmd of withOptions) {
      const schema = parametersFor(cmd) as {
        properties: Record<string, { enum?: readonly string[] }>;
      };
      for (const field of cmd.fields ?? []) {
        if (!field.options) continue;
        expect(schema.properties[field.name].enum).toEqual([...field.options]);
      }
    }
  });

  it("gives a caller-priced command somewhere to name its amount", () => {
    // Otherwise the model can propose a duel it has no way to price, and the
    // route refuses it as a bad field with no hint about which one.
    const callerPriced = COMMANDS.filter(isCallerPriced);
    expect(callerPriced.length).toBeGreaterThan(0);

    for (const cmd of callerPriced) {
      const names = Object.keys(
        (parametersFor(cmd) as { properties: Record<string, unknown> }).properties,
      );
      const amountField = cmd.amountField ?? "maxCents";
      expect(names, `${cmd.id} cannot name an amount`).toContain(amountField);
    }
  });
});

describe("the description tells the model the rule instead of making it discover one", () => {
  it("marks a signed or paid tool proposal-only in reads mode", () => {
    const tools = toolsFor(ALL_ENABLED, "reads");
    for (const cmd of COMMANDS) {
      if (cmd.tier === "free" || cmd.destructive) continue;
      const tool = tools.find((t) => t.name === toolName(cmd))!;
      expect(tool.description, `${cmd.id} does not say it is proposal-only`).toContain(
        "PROPOSAL ONLY",
      );
    }
  });

  it("drops that sentence under full autonomy, where it would be a lie", () => {
    const tools = toolsFor(ALL_ENABLED, "full");
    for (const tool of tools) {
      expect(tool.description).not.toContain("PROPOSAL ONLY");
    }
  });

  it("never marks a free read proposal-only, in either mode", () => {
    for (const mode of ["reads", "full"] as const) {
      const tools = toolsFor(ALL_ENABLED, mode);
      for (const cmd of COMMANDS.filter((c) => c.tier === "free")) {
        const tool = tools.find((t) => t.name === toolName(cmd))!;
        expect(tool.description).not.toContain("PROPOSAL ONLY");
      }
    }
  });

  it("says a destructive command is the operator's click in every mode", () => {
    const destructive = COMMANDS.filter((c) => c.destructive);
    expect(destructive.length).toBeGreaterThan(0);

    for (const mode of ["reads", "full"] as const) {
      const tools = toolsFor(ALL_ENABLED, mode);
      for (const cmd of destructive) {
        const tool = tools.find((t) => t.name === toolName(cmd))!;
        expect(tool.description, `${cmd.id} in ${mode}`).toContain("DESTRUCTIVE");
      }
    }
  });

  it("carries the catalogue's own price label rather than one written here", () => {
    const tools = toolsFor(ALL_ENABLED, "reads");
    for (const cmd of COMMANDS.filter((c) => c.tier !== "free")) {
      const tool = tools.find((t) => t.name === toolName(cmd))!;
      expect(tool.description).toContain(cmd.price);
    }
  });

  it("carries the catalogue's note verbatim where there is one", () => {
    const tools = toolsFor(ALL_ENABLED, "reads");
    for (const cmd of COMMANDS.filter((c) => c.note)) {
      const tool = tools.find((t) => t.name === toolName(cmd))!;
      expect(tool.description).toContain(cmd.note!);
    }
  });
});
