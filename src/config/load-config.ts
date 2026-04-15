import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { forgeConfigSchema, type ForgeConfig } from "./schema.js";

export async function loadConfig(configPath = "forge.config.ts"): Promise<ForgeConfig> {
  const resolvedPath = resolve(configPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  const module = await import(pathToFileURL(resolvedPath).href);
  return forgeConfigSchema.parse(module.default ?? module);
}
