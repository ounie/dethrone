import "server-only";
import type { ChatProvider, ModelChoice, ProviderId } from "../../agent";
import { isServerless } from "../../assertions";
import type { ChatProviderAdapter } from "../types";

/**
 * Which model providers can actually run on this deploy, and why not, for the
 * ones that cannot.
 *
 * ## Availability is a fact about the server, and it is computed here
 *
 * The browser never guesses. It is handed `available` and, when false, a
 * sentence — the same contract `Capability.reason` has for commands, and for
 * the same reason: a client that worked out "this deploy probably has no key"
 * for itself is a second implementation of the deployment's own configuration.
 *
 * ## Claude Max is the interesting one
 *
 * It is the only provider that needs **no key**, and the only one that cannot
 * run everywhere. It drives a local `claude` subprocess through the Claude Agent
 * SDK, which inherits credentials the operator already holds from Claude Code or
 * `ant auth login` — so a Max or Pro subscription pays for it and there is no
 * API key in this process to leak. Those are the same fact seen twice: it works
 * because there is a machine with credentials on it, so it does not work where
 * there is neither. On serverless it renders unavailable and says why, rather
 * than failing at the first message.
 */

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  "claude-max": "Claude (Max / Pro subscription)",
  openrouter: "OpenRouter",
  anthropic: "Anthropic API",
  "openai-compatible": "OpenAI-compatible",
};

/** How long a model catalogue is reused before being fetched again. */
const MODEL_CACHE_MS = 10 * 60 * 1000;

interface CacheEntry {
  at: number;
  models: ModelChoice[];
  reason?: string;
}

const CACHE_KEY = "__dethrone_console_models__";

function cache(): Map<string, CacheEntry> {
  const g = globalThis as unknown as Record<string, Map<string, CacheEntry> | undefined>;
  return (g[CACHE_KEY] ??= new Map());
}

/**
 * A model catalogue, fetched at most once per window.
 *
 * A failure is **not** an error state. The provider stays available with an
 * empty list and a reason, and the picker degrades to a free-text model id.
 * The alternative — a hard-coded list in this repo — is the catalogue-drift
 * mistake in a new place: it would be wrong within weeks and there would be no
 * test that could tell.
 */
export async function cachedModels(
  id: string,
  load: () => Promise<ModelChoice[]>,
): Promise<{ models: ModelChoice[]; reason?: string }> {
  const now = Date.now();
  const hit = cache().get(id);
  if (hit && now - hit.at < MODEL_CACHE_MS) return { models: hit.models, reason: hit.reason };

  try {
    const models = await load();
    cache().set(id, { at: now, models });
    return { models };
  } catch (err) {
    const reason = `The model list could not be loaded (${
      err instanceof Error ? err.message : String(err)
    }). Type a model id instead.`;
    cache().set(id, { at: now, models: [], reason });
    return { models: [], reason };
  }
}

export interface ProviderModule {
  id: ProviderId;
  /** Why this provider cannot run here, or null when it can. */
  unavailable(env: NodeJS.ProcessEnv): string | null;
  models(): Promise<{ models: ModelChoice[]; reason?: string }>;
  adapter(): Promise<ChatProviderAdapter>;
}

/** Registered lazily so a provider's SDK is never imported on a deploy that cannot use it. */
const MODULES: Record<ProviderId, () => Promise<ProviderModule>> = {
  "claude-max": async () => (await import("./claude-max")).provider,
  openrouter: async () => (await import("./openrouter")).provider,
  anthropic: async () => (await import("./anthropic")).provider,
  "openai-compatible": async () => (await import("./openai-compatible")).provider,
};

export const PROVIDER_IDS = Object.keys(MODULES) as ProviderId[];

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as string[]).includes(value);
}

/** Availability only — cheap, no network, no SDK import. */
export async function providerAvailability(): Promise<Record<ProviderId, string | null>> {
  const out = {} as Record<ProviderId, string | null>;
  for (const id of PROVIDER_IDS) {
    const mod = await MODULES[id]();
    out[id] = mod.unavailable(process.env);
  }
  return out;
}

/** Availability plus model lists. The shape the browser is handed. */
export async function providerStatuses(): Promise<ChatProvider[]> {
  const out: ChatProvider[] = [];

  for (const id of PROVIDER_IDS) {
    const mod = await MODULES[id]();
    const reason = mod.unavailable(process.env);

    if (reason !== null) {
      out.push({ id, label: PROVIDER_LABELS[id], available: false, reason, models: [] });
      continue;
    }

    const { models, reason: modelsReason } = await mod.models();
    out.push({
      id,
      label: PROVIDER_LABELS[id],
      available: true,
      models,
      ...(modelsReason ? { modelsReason } : {}),
    });
  }

  return out;
}

export async function adapterFor(id: ProviderId): Promise<ChatProviderAdapter | null> {
  const mod = await MODULES[id]();
  if (mod.unavailable(process.env) !== null) return null;
  return mod.adapter();
}

/** Shared by the two providers whose availability is "is this key set". */
export function requireEnv(env: NodeJS.ProcessEnv, names: string[], what: string): string | null {
  const missing = names.filter((n) => !env[n]?.trim());
  if (missing.length === 0) return null;
  return `${what} needs ${missing.join(" and ")}, which ${
    missing.length > 1 ? "are" : "is"
  } not set on this deploy.`;
}

/** True where no subprocess can be spawned and no user credentials exist to inherit. */
export function subprocessImpossible(env: NodeJS.ProcessEnv): boolean {
  return isServerless(env);
}
