import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "../../config/define-config.js";
import { OpenAICodexAuthManager } from "./openai-codex-auth.js";

test("openai-codex login stores oauth credentials and resolves an access token", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "forge-openai-codex-"));
  const authManager = new OpenAICodexAuthManager(
    defineConfig({
      agent: {
        provider: {
          kind: "openai-codex",
          authMode: "login",
          model: "gpt-5.4",
          apiKeyEnvVar: "OPENAI_API_KEY",
          originator: "forge"
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
    }),
    async () => ({
      access: "oauth-access",
      refresh: "oauth-refresh",
      expires: Date.now() + 60_000,
      accountId: "acct_123"
    }),
    async (_providerId, credentials) => ({
      newCredentials: credentials["openai-codex"]!,
      apiKey: credentials["openai-codex"]!.access
    })
  );

  try {
    await authManager.login(
      projectRoot,
      {
        kind: "openai-codex",
        authMode: "login",
        model: "gpt-5.4",
        apiKeyEnvVar: "OPENAI_API_KEY",
        originator: "forge"
      },
      false
    );

    const apiKey = await authManager.resolveApiKey(projectRoot, {
      kind: "openai-codex",
      authMode: "login",
      model: "gpt-5.4",
      apiKeyEnvVar: "OPENAI_API_KEY",
      originator: "forge"
    });

    assert.equal(apiKey, "oauth-access");
    assert.equal(await authManager.logout(projectRoot), true);
    await assert.rejects(() =>
      authManager.resolveApiKey(projectRoot, {
        kind: "openai-codex",
        authMode: "login",
        model: "gpt-5.4",
        apiKeyEnvVar: "OPENAI_API_KEY",
        originator: "forge"
      })
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
