import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ForgeConfig } from "../config/schema.js";
import { getForgeTools } from "../tools/index.js";

export async function buildSystemPrompt(input: {
  projectRoot: string;
  config: ForgeConfig;
  appendPrompt?: string;
}): Promise<{
  text: string;
  contributors: Array<{ source: string; content: string }>;
}> {
  const contributors: Array<{ source: string; content: string }> = [];

  for (const filePath of input.config.agent.systemPromptFiles) {
    const resolvedPath = resolve(input.projectRoot, filePath);
    const content = await readFile(resolvedPath, "utf8");
    contributors.push({
      source: `file:${filePath}`,
      content: `# Source: ${filePath}\n\n${content.trim()}`
    });
  }

  contributors.push({
    source: "run_context",
    content: buildRunContextBlock(input.projectRoot, input.config)
  });

  if (input.appendPrompt?.trim()) {
    contributors.push({
      source: "cli_append_prompt",
      content: `# CLI Override\n\n${input.appendPrompt.trim()}`
    });
  }

  return {
    text: contributors.map((contributor) => contributor.content).join("\n\n"),
    contributors
  };
}

function buildRunContextBlock(
  projectRoot: string,
  config: ForgeConfig
): string {
  const safeTools = getForgeTools()
    .filter((tool) => tool.riskLevel === "safe")
    .map((tool) => tool.name);
  const guardedTools = getForgeTools()
    .filter((tool) => tool.riskLevel === "guarded")
    .map((tool) => tool.name);
  const allowlist =
    config.permissions.commandAllowlist.length > 0
      ? config.permissions.commandAllowlist
          .map((entry) => [entry.command, ...entry.argsPrefix].join(" ").trim())
          .join(", ")
      : "(none)";

  return [
    "# Run Context",
    "",
    `Project root: ${projectRoot}`,
    `Current date: ${new Date().toISOString()}`,
    `Project root mode: ${config.permissions.projectRootMode}`,
    `Allowlisted commands: ${allowlist}`,
    `Safe tools: ${safeTools.join(", ") || "(none)"}`,
    `Guarded tools: ${guardedTools.join(", ") || "(none)"}`
  ].join("\n");
}
