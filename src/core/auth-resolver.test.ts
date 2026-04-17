import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "../config/define-config.js";
import { resolveAuth } from "./auth-resolver.js";

function createConfig() {
  return defineConfig({
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
  });
}

test("auth resolver prefers explicit config value over env and state file", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "forge-auth-config-"));
  const config = createConfig();
  const previous = process.env.FORGE_TEST_OPENAI_API_KEY;

  try {
    await mkdir(join(projectRoot, ".forge", "auth", "openai"), {
      recursive: true
    });
    await writeFile(
      join(projectRoot, ".forge", "auth", "openai", "login.json"),
      JSON.stringify({
        apiKey: "file-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: "browser_assisted_login"
      })
    );
    process.env.FORGE_TEST_OPENAI_API_KEY = "env-key";

    const resolved = await resolveAuth(
      {
        kind: "openai",
        authMode: "api_key",
        model: "gpt-5.4",
        apiKey: "config-key",
        apiKeyEnvVar: "FORGE_TEST_OPENAI_API_KEY"
      },
      config,
      projectRoot
    );

    assert.deepEqual(resolved, {
      kind: "api_key",
      value: "config-key",
      source: "config"
    });
  } finally {
    if (previous === undefined) {
      delete process.env.FORGE_TEST_OPENAI_API_KEY;
    } else {
      process.env.FORGE_TEST_OPENAI_API_KEY = previous;
    }
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("auth resolver prefers env over stored state for codex", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "forge-auth-env-"));
  const config = createConfig();
  const previous = process.env.FORGE_TEST_CODEX_API_KEY;

  try {
    await mkdir(join(projectRoot, ".forge", "auth", "openai-codex"), {
      recursive: true
    });
    await writeFile(
      join(projectRoot, ".forge", "auth", "openai-codex", "oauth.json"),
      JSON.stringify({
        "openai-codex": {
          access: "file-access",
          refresh: "file-refresh",
          expires: Date.now() + 60_000
        }
      })
    );
    process.env.FORGE_TEST_CODEX_API_KEY = "env-access";

    const resolved = await resolveAuth(
      {
        kind: "openai-codex",
        authMode: "login",
        model: "gpt-5.4",
        apiKeyEnvVar: "FORGE_TEST_CODEX_API_KEY",
        originator: "forge"
      },
      config,
      projectRoot
    );

    assert.deepEqual(resolved, {
      kind: "api_key",
      value: "env-access",
      source: "env"
    });
  } finally {
    if (previous === undefined) {
      delete process.env.FORGE_TEST_CODEX_API_KEY;
    } else {
      process.env.FORGE_TEST_CODEX_API_KEY = previous;
    }
    await rm(projectRoot, { recursive: true, force: true });
  }
});
