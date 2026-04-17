import test from "node:test";
import assert from "node:assert/strict";
import { forgeConfigSchema } from "./schema.js";

test("forge config accepts openai api_key provider mode", () => {
  const parsed = forgeConfigSchema.parse({
    agent: {
      provider: {
        kind: "openai",
        authMode: "api_key",
        model: "gpt-5.4",
        apiKeyEnvVar: "OPENAI_API_KEY"
      }
    },
    runtime: {
      stateDir: ".forge",
      sqlitePath: ".forge/forge.db"
    },
    permissions: {
      projectRootMode: "cwd",
      commandAllowlist: []
    }
  });

  assert.equal(parsed.agent.provider.kind, "openai");
  assert.equal(parsed.agent.provider.authMode, "api_key");
});

test("forge config accepts openai-codex login provider mode", () => {
  const parsed = forgeConfigSchema.parse({
    agent: {
      provider: {
        kind: "openai-codex",
        authMode: "login",
        model: "gpt-5.4",
        originator: "forge"
      }
    },
    runtime: {
      stateDir: ".forge",
      sqlitePath: ".forge/forge.db"
    },
    permissions: {
      projectRootMode: "cwd",
      commandAllowlist: []
    }
  });

  assert.equal(parsed.agent.provider.kind, "openai-codex");
  assert.equal(parsed.agent.provider.authMode, "login");
});

test("forge config rejects unknown auth modes", () => {
  assert.throws(() =>
    forgeConfigSchema.parse({
      agent: {
        provider: {
          kind: "openai",
          authMode: "token_exchange",
          model: "gpt-5.4",
          apiKeyEnvVar: "OPENAI_API_KEY"
        }
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
});
