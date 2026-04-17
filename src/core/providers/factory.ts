import type {
  AuthMode,
  ForgeConfig,
  OpenAICodexProviderConfig,
  OpenAIProviderConfig,
  ProviderConfig,
  ProviderKind
} from "../../config/schema.js";
import type { RunRecord } from "../types.js";
import { OpenAIAuthManager } from "./openai-auth.js";
import { OpenAIAgentProvider } from "./openai-agent-provider.js";
import { OpenAICodexAgentProvider } from "./openai-codex-agent-provider.js";
import { OpenAICodexAuthManager } from "./openai-codex-auth.js";

export interface ProviderOverrides {
  provider?: ProviderKind;
  authMode?: AuthMode;
}

export function resolveProviderConfig(
  config: ForgeConfig,
  overrides?: ProviderOverrides
): ProviderConfig {
  const baseConfig = config.agent.provider;
  const targetProvider = overrides?.provider ?? baseConfig.kind;

  if (targetProvider === "openai") {
    const source =
      baseConfig.kind === "openai"
        ? baseConfig
        : {
            kind: "openai" as const,
            authMode: "api_key" as const,
            model: baseConfig.model,
            apiKey: undefined,
            apiKeyEnvVar: "OPENAI_API_KEY"
          };

    return {
      ...source,
      authMode: "api_key"
    } satisfies OpenAIProviderConfig;
  }

  if (targetProvider === "openai-codex") {
    const source =
      baseConfig.kind === "openai-codex"
        ? baseConfig
        : {
            kind: "openai-codex" as const,
            authMode: "login" as const,
            model: baseConfig.model,
            apiKey: undefined,
            apiKeyEnvVar: "OPENAI_API_KEY",
            originator: "forge"
          };

    return {
      ...source,
      authMode: "login"
    } satisfies OpenAICodexProviderConfig;
  }

  return baseConfig;
}

export function resolveProviderConfigForRun(
  config: ForgeConfig,
  run: RunRecord
): ProviderConfig {
  const baseConfig = config.agent.provider;

  if (run.provider === "openai") {
    const source =
      baseConfig.kind === "openai"
        ? baseConfig
        : {
            kind: "openai" as const,
            authMode: "api_key" as const,
            model: run.model,
            apiKey: undefined,
            apiKeyEnvVar: "OPENAI_API_KEY"
          };

    return {
      ...source,
      model: run.model,
      authMode: "api_key"
    } satisfies OpenAIProviderConfig;
  }

  if (run.provider === "openai-codex") {
    const source =
      baseConfig.kind === "openai-codex"
        ? baseConfig
        : {
            kind: "openai-codex" as const,
            authMode: "login" as const,
            model: run.model,
            apiKey: undefined,
            apiKeyEnvVar: "OPENAI_API_KEY",
            originator: "forge"
          };

    return {
      ...source,
      model: run.model,
      authMode: "login"
    } satisfies OpenAICodexProviderConfig;
  }

  throw new Error(
    `Unsupported provider recorded on run ${run.id}: ${run.provider}`
  );
}

export function createAgentProvider(
  config: ForgeConfig,
  providerConfig: ProviderConfig
) {
  switch (providerConfig.kind) {
    case "openai":
      return new OpenAIAgentProvider(config, new OpenAIAuthManager(config));
    case "openai-codex":
      return new OpenAICodexAgentProvider(
        config,
        new OpenAICodexAuthManager(config)
      );
    default:
      throw new Error(
        `Unsupported provider: ${(providerConfig as ProviderConfig).kind}`
      );
  }
}

export function createProviderAuthManager(
  config: ForgeConfig,
  provider: ProviderKind
) {
  switch (provider) {
    case "openai":
      return new OpenAIAuthManager(config);
    case "openai-codex":
      return new OpenAICodexAuthManager(config);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
