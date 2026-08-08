import "server-only";
import { cachedModels, requireEnv, type ProviderModule } from "./registry";
import { loadOpenAiModels, runOpenAiShape, type OpenAiShapeConfig } from "./openai-shape";

/**
 * Anything that speaks the OpenAI chat-completions shape: Ollama, llama.cpp,
 * Groq, Together, a gateway of the operator's own.
 *
 * The base URL is theirs, which is the entire point and also the reason this
 * provider is off unless they set one. The console makes no attempt to guess at
 * a local endpoint — a console that quietly discovers a listening port and
 * starts sending an operator's transcript to it has made a decision that was
 * not its to make.
 *
 * `test/one-fetch.test.ts` names this file in its outbound exemption list, for
 * the same reason and to the same standard as `openrouter.ts`.
 */

function config(): OpenAiShapeConfig {
  return {
    baseUrl: process.env.OPENAI_COMPATIBLE_BASE_URL?.trim() ?? "",
    apiKey: process.env.OPENAI_COMPATIBLE_API_KEY?.trim() ?? "",
    label: process.env.OPENAI_COMPATIBLE_LABEL?.trim() || "the OpenAI-compatible endpoint",
  };
}

export const provider: ProviderModule = {
  id: "openai-compatible",

  unavailable(env) {
    return requireEnv(
      env,
      ["OPENAI_COMPATIBLE_BASE_URL", "OPENAI_COMPATIBLE_API_KEY"],
      "An OpenAI-compatible provider",
    );
  },

  models() {
    return cachedModels("openai-compatible", () => loadOpenAiModels(config()));
  },

  async adapter() {
    return {
      id: "openai-compatible",
      run: (input, execute) => runOpenAiShape(config(), input, execute),
    };
  },
};
