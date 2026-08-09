import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Which providers can run here, and what they say when they cannot.
 *
 * The reasons are the whole point of this file. They are rendered verbatim
 * beside a disabled provider, they are the only thing an operator has to go on
 * when the pane will not work, and they are the sort of string that rots
 * silently — so each one is asserted to name the specific thing to do rather
 * than merely to be non-empty.
 */

afterEach(() => vi.unstubAllEnvs());

/** A partial environment, typed for `unavailable(env)`. */
function env(over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return over as NodeJS.ProcessEnv;
}

/**
 * A PATH containing a `claude` that exists, built here rather than borrowed
 * from the machine.
 *
 * The first version of this file used `process.env.PATH` and asserted the
 * provider was available. That passed on a laptop with Claude Code installed
 * and failed in CI, which is to say it asserted a property of the developer's
 * machine rather than of the code — the exact thing a test must not do. CI
 * caught it, correctly, on a docs-only pull request.
 */
let fakeBin: string;

beforeAll(() => {
  fakeBin = mkdtempSync(join(tmpdir(), "console-claude-"));
  const exe = join(fakeBin, process.platform === "win32" ? "claude.cmd" : "claude");
  writeFileSync(exe, "#!/bin/sh\nexit 0\n");
  chmodSync(exe, 0o755);
});

afterAll(() => rmSync(fakeBin, { recursive: true, force: true }));

/** Deterministic "Claude Code is installed", on any machine. */
const bare = () => env({ PATH: fakeBin });

describe("claude-max: the one that needs no key, and the one that cannot run everywhere", () => {
  it("is available locally, with no key of any kind set", async () => {
    const { provider } = await import("@/lib/chat/providers/claude-max");
    expect(provider.unavailable(bare())).toBeNull();
  });

  /**
   * The serverless message must do two things, and the second is the one that
   * is easy to drop: say the subscription is local-only, AND name the remedy.
   * "This does not work here" without "use an API key instead" leaves the
   * operator to guess, on the screen where they have just deployed.
   */
  it("says local-only on a hosted deploy, and names the way out", async () => {
    const { provider } = await import("@/lib/chat/providers/claude-max");
    const reason = provider.unavailable(env({ ...bare(), VERCEL: "1" }))!;

    expect(reason).toMatch(/LOCAL RUNS ONLY/);
    // The remedy, not just the diagnosis.
    expect(reason).toContain("OPENROUTER_API_KEY");
    expect(reason).toContain("ANTHROPIC_API_KEY");
  });

  it("defaults to Sonnet — the picker takes the first entry", async () => {
    const { provider } = await import("@/lib/chat/providers/claude-max");
    const { models } = await provider.models();
    expect(models[0].id).toBe("sonnet");
  });

  /**
   * The gap this closes: the console never asks you to authenticate — it
   * borrows a session you already hold — so the only way you learn it is
   * missing is if something tells you. Availability used to be "not serverless"
   * and nothing else, which meant a machine without Claude Code rendered the
   * provider as ready and then failed opaquely on the first turn.
   */
  it("names `claude login` when the binary is not reachable", async () => {
    const { provider } = await import("@/lib/chat/providers/claude-max");
    const reason = provider.unavailable(env({ PATH: "/nonexistent" }));
    expect(reason).toContain("claude login");
    // And the non-obvious cause, because it is the one that wastes an hour:
    // a dev server launched from a GUI app inherits a trimmed PATH.
    expect(reason).toContain("PATH");
  });

  it("honours the explicit off switch", async () => {
    const { provider } = await import("@/lib/chat/providers/claude-max");
    expect(provider.unavailable(env({ ...bare(), CONSOLE_CHAT_DISABLE_SUBPROCESS: "true" }))).toContain(
      "CONSOLE_CHAT_DISABLE_SUBPROCESS",
    );
  });

  it("reports the subscription's models without a network call", async () => {
    const { provider } = await import("@/lib/chat/providers/claude-max");
    const { models } = await provider.models();
    expect(models.length).toBeGreaterThan(0);
  });
});

describe("the three key-based providers name the variable they need", () => {
  it("openrouter asks for OPENROUTER_API_KEY", async () => {
    const { provider } = await import("@/lib/chat/providers/openrouter");
    expect(provider.unavailable(env())).toContain("OPENROUTER_API_KEY");
  });

  it("anthropic asks for ANTHROPIC_API_KEY", async () => {
    const { provider } = await import("@/lib/chat/providers/anthropic");
    expect(provider.unavailable(env())).toContain("ANTHROPIC_API_KEY");
  });

  it("openai-compatible asks for its base URL", async () => {
    const { provider } = await import("@/lib/chat/providers/openai-compatible");
    expect(provider.unavailable(env())).toContain("OPENAI_COMPATIBLE_BASE_URL");
  });

  it("openai-compatible names BOTH variables, not just the first missing one", async () => {
    const { provider } = await import("@/lib/chat/providers/openai-compatible");
    const reason = provider.unavailable(env());
    expect(reason).toContain("OPENAI_COMPATIBLE_BASE_URL");
    expect(reason).toContain("OPENAI_COMPATIBLE_API_KEY");
  });

  it("goes available once its key is present", async () => {
    const { provider } = await import("@/lib/chat/providers/openrouter");
    expect(provider.unavailable(env({ OPENROUTER_API_KEY: "sk-or-v1-x" }))).toBeNull();
  });
});

/**
 * The label has to be true, and it is only true because the subprocess is
 * denied the variables that would quietly make it false.
 *
 * Measured before this was written: with `ANTHROPIC_API_KEY` set, the SDK
 * reported `apiKeySource = ANTHROPIC_API_KEY`; without it, `none`. So a console
 * that had set that key to enable the *Anthropic API* provider would have had
 * the *subscription* provider billing the API, under a label saying otherwise.
 */
describe("the subscription provider cannot be made to bill an API key", () => {
  it("strips both credential variables from the subprocess environment", async () => {
    const { read, SRC } = await import("./graph");
    const source = read(join(SRC, "lib/chat/providers/claude-max.ts"));

    // The env is handed to the SDK, so the stripping must be visible here.
    expect(source).toMatch(/env:\s*withoutApiKeys\(process\.env\)/);
    expect(source).toContain('k === "ANTHROPIC_API_KEY"');
    expect(source).toContain('k === "ANTHROPIC_AUTH_TOKEN"');
  });

  it("does not name the tools in allowedTools, which would shadow the gate", async () => {
    // CLAUDE_SDK_CAN_USE_TOOL_SHADOWED: a bare name in allowedTools
    // auto-approves before canUseTool runs, making the callback dead code for
    // every tool it was written to allow.
    const { read, SRC } = await import("./graph");
    const source = read(join(SRC, "lib/chat/providers/claude-max.ts"));

    expect(source).toMatch(/allowedTools:\s*\[\]/);
    expect(source).toContain("canUseTool:");
  });
});
