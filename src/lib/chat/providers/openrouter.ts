import "server-only";
import { cachedModels, requireEnv, type ProviderModule } from "./registry";
import { loadOpenAiModels, runOpenAiShape, type OpenAiShapeConfig } from "./openai-shape";

/**
 * OpenRouter: one key, one live catalogue, several hundred models.
 *
 * This is the provider that makes the model picker worth having. The catalogue
 * is fetched from OpenRouter rather than listed here, so the picker cannot go
 * stale — and `pricing` is dropped in the mapper, because this console does no
 * token accounting.
 *
 * `test/one-fetch.test.ts` names this file in its outbound exemption list. It
 * reads no `DETHRONE_BASE_URL`, mints no signature and cannot attach a payment,
 * which is the standard that list holds an entry to.
 */

const BASE_URL = "https://openrouter.ai/api/v1";

function config(): OpenAiShapeConfig {
  return {
    baseUrl: BASE_URL,
    apiKey: process.env.OPENROUTER_API_KEY?.trim() ?? "",
    label: "OpenRouter",
    headers: {
      // OpenRouter's attribution headers. Public strings, no identifiers.
      "http-referer": "https://dethrone.bot",
      "x-title": "Dethrone Console",
    },
  };
}

export const provider: ProviderModule = {
  id: "openrouter",

  unavailable(env) {
    return requireEnv(env, ["OPENROUTER_API_KEY"], "OpenRouter");
  },

  models() {
    return cachedModels("openrouter", () => loadOpenAiModels(config()));
  },

  async adapter() {
    return {
      id: "openrouter",
      run: (input, execute) => runOpenAiShape(config(), input, execute),
    };
  },
};
