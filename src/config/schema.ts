import { z } from "zod";

export const providerKindSchema = z.enum(["openai", "openai-codex"]);
export const authModeSchema = z.enum(["api_key", "login"]);

export const commandAllowlistEntrySchema = z.object({
  command: z.string().min(1),
  argsPrefix: z.array(z.string()).default([]),
  description: z.string().optional()
});

export const openAIProviderConfigSchema = z.object({
  kind: z.literal("openai"),
  authMode: z.literal("api_key").default("api_key"),
  model: z.string().min(1).default("gpt-5.4"),
  apiKeyEnvVar: z.string().min(1).default("OPENAI_API_KEY"),
  baseUrl: z.string().url().optional()
});

export const openAICodexProviderConfigSchema = z.object({
  kind: z.literal("openai-codex"),
  authMode: z.literal("login").default("login"),
  model: z.string().min(1).default("gpt-5.4"),
  originator: z.string().min(1).default("forge")
});

export const providerConfigSchema = z.discriminatedUnion("kind", [
  openAIProviderConfigSchema,
  openAICodexProviderConfigSchema
]);

export const forgeConfigSchema = z.object({
  agent: z.object({
    provider: providerConfigSchema.default({
      kind: "openai",
      authMode: "api_key",
      model: "gpt-5.4",
      apiKeyEnvVar: "OPENAI_API_KEY"
    }),
    thinkingLevel: z.enum(["off", "low", "medium", "high"]).default("medium"),
    systemPromptFiles: z.array(z.string().min(1)).default([])
  }),
  runtime: z.object({
    stateDir: z.string().min(1).default(".forge"),
    sqlitePath: z.string().min(1).default(".forge/forge.db")
  }),
  permissions: z.object({
    projectRootMode: z.enum(["cwd", "explicit"]).default("cwd"),
    commandAllowlist: z.array(commandAllowlistEntrySchema).default([])
  })
});

export type ProviderKind = z.infer<typeof providerKindSchema>;
export type AuthMode = z.infer<typeof authModeSchema>;
export type OpenAIProviderConfig = z.infer<typeof openAIProviderConfigSchema>;
export type OpenAICodexProviderConfig = z.infer<typeof openAICodexProviderConfigSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type ForgeConfig = z.infer<typeof forgeConfigSchema>;
