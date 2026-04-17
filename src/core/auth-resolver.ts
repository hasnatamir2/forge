import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type {
  ForgeConfig,
  OpenAICodexProviderConfig,
  OpenAIProviderConfig,
  ProviderConfig
} from "../config/schema.js";
import type { ResolvedAuthContext } from "./types.js";

const openAIStoredLoginStateSchema = z.object({
  apiKey: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  source: z.literal("browser_assisted_login")
});

const openAICodexStoredCredentialsSchema = z.record(
  z.string(),
  z
    .object({
      access: z.string().min(1),
      refresh: z.string().min(1),
      expires: z.number(),
      accountId: z.string().min(1).optional()
    })
    .catchall(z.unknown())
);

export async function resolveAuth(
  providerConfig: ProviderConfig,
  config: ForgeConfig,
  projectRoot: string
): Promise<ResolvedAuthContext> {
  switch (providerConfig.kind) {
    case "openai":
      return resolveOpenAIAuth(providerConfig, config, projectRoot);
    case "openai-codex":
      return resolveOpenAICodexAuth(providerConfig, config, projectRoot);
    default:
      throw new Error(
        `Unsupported provider: ${(providerConfig as ProviderConfig).kind}`
      );
  }
}

async function resolveOpenAIAuth(
  providerConfig: OpenAIProviderConfig,
  config: ForgeConfig,
  projectRoot: string
): Promise<ResolvedAuthContext> {
  if (providerConfig.apiKey) {
    return {
      kind: "api_key",
      value: providerConfig.apiKey,
      source: "config"
    };
  }

  const envValue = process.env[providerConfig.apiKeyEnvVar];
  if (envValue) {
    return {
      kind: "api_key",
      value: envValue,
      source: "env"
    };
  }

  const statePath = await findFirstExistingPath(
    getOpenAIAuthPaths(config, projectRoot)
  );
  if (statePath) {
    const state = openAIStoredLoginStateSchema.parse(
      JSON.parse(await readFile(statePath, "utf8"))
    );
    return {
      kind: "api_key",
      value: state.apiKey,
      source: "state_file",
      path: statePath
    };
  }

  throw new Error(
    `Missing OpenAI API key. Set ${providerConfig.apiKeyEnvVar}, add agent.provider.apiKey, or run "forge auth login --provider openai".`
  );
}

async function resolveOpenAICodexAuth(
  providerConfig: OpenAICodexProviderConfig,
  config: ForgeConfig,
  projectRoot: string
): Promise<ResolvedAuthContext> {
  if (providerConfig.apiKey) {
    return {
      kind: "api_key",
      value: providerConfig.apiKey,
      source: "config"
    };
  }

  const envValue = process.env[providerConfig.apiKeyEnvVar];
  if (envValue) {
    return {
      kind: "api_key",
      value: envValue,
      source: "env"
    };
  }

  const statePath = await findFirstExistingPath([
    resolve(
      projectRoot,
      config.runtime.stateDir,
      "auth",
      "openai-codex",
      "oauth.json"
    )
  ]);
  if (statePath) {
    const credentials = openAICodexStoredCredentialsSchema.parse(
      JSON.parse(await readFile(statePath, "utf8"))
    );
    return {
      kind: "session",
      value: credentials,
      source: "state_file",
      path: statePath
    };
  }

  throw new Error(
    `OpenAI Codex auth is not configured. Set ${providerConfig.apiKeyEnvVar}, add agent.provider.apiKey, or run "forge auth login --provider openai-codex".`
  );
}

function getOpenAIAuthPaths(
  config: ForgeConfig,
  projectRoot: string
): string[] {
  return [
    resolve(
      projectRoot,
      config.runtime.stateDir,
      "auth",
      "openai",
      "login.json"
    ),
    resolve(
      projectRoot,
      config.runtime.stateDir,
      "auth",
      "openai",
      "login",
      "login.json"
    )
  ];
}

async function findFirstExistingPath(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}
