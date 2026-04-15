import { existsSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import type { ForgeConfig } from "../config/schema.js";

export function resolveProjectRoot(config: ForgeConfig, projectRootOverride?: string): string {
  if (projectRootOverride) {
    return resolve(projectRootOverride);
  }

  if (config.permissions.projectRootMode === "cwd") {
    return process.cwd();
  }

  throw new Error("projectRoot is required when projectRootMode is 'explicit'");
}

export function assertWithinProjectRoot(projectRoot: string, targetPath: string): string {
  const resolvedRoot = resolve(projectRoot);
  const resolvedTarget = resolve(resolvedRoot, targetPath);
  const relativePath = relative(resolvedRoot, resolvedTarget);

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath.includes(`${sep}..${sep}`)
  ) {
    throw new Error(`Path escapes project root: ${targetPath}`);
  }

  return resolvedTarget;
}

export function ensureFileParentAllowed(projectRoot: string, targetPath: string): string {
  return assertWithinProjectRoot(projectRoot, targetPath);
}

export function isCommandAllowed(
  config: ForgeConfig,
  command: string,
  args: string[]
): { allowed: boolean; reason?: string } {
  const entry = config.permissions.commandAllowlist.find((candidate) => {
    if (candidate.command !== command) {
      return false;
    }

    if (candidate.argsPrefix.length > args.length) {
      return false;
    }

    return candidate.argsPrefix.every((part, index) => args[index] === part);
  });

  if (!entry) {
    return {
      allowed: false,
      reason: `Command is not in allowlist: ${[command, ...args].join(" ")}`
    };
  }

  return { allowed: true };
}

export function optionalExistingPath(pathValue: string): string {
  if (!existsSync(pathValue)) {
    throw new Error(`Path not found: ${pathValue}`);
  }

  return pathValue;
}
