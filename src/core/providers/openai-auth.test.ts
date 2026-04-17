import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIAuthManager } from "./openai-auth.js";
import { defineConfig } from "../../config/define-config.js";

test("openai api_key mode reads from the configured environment variable", async () => {
  const authManager = new OpenAIAuthManager(
    defineConfig({
      agent: {
        provider: {
          kind: "openai",
          authMode: "api_key",
          model: "gpt-5.4",
          apiKeyEnvVar: "FORGE_TEST_OPENAI_API_KEY"
        },
        thinkingLevel: "medium",
        systemPromptFiles: []
      },
      runtime: {
        stateDir: ".forge",
        sqlitePath: ".forge/forge.db"
      },
      permissions: {
        projectRootMode: "cwd",
        commandAllowlist: []
      }
    })
  );
  const previous = process.env.FORGE_TEST_OPENAI_API_KEY;

  try {
    process.env.FORGE_TEST_OPENAI_API_KEY = "env-key";
    const apiKey = await authManager.resolveApiKey(process.cwd(), {
      kind: "openai",
      authMode: "api_key",
      model: "gpt-5.4",
      apiKeyEnvVar: "FORGE_TEST_OPENAI_API_KEY"
    });
    assert.equal(apiKey, "env-key");
  } finally {
    if (previous === undefined) {
      delete process.env.FORGE_TEST_OPENAI_API_KEY;
    } else {
      process.env.FORGE_TEST_OPENAI_API_KEY = previous;
    }
  }
});
