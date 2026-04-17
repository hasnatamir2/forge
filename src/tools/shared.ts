import { readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { relative, resolve } from "node:path";

export async function collectFiles(
  directory: string,
  options: { recursive: boolean; includeHidden: boolean; limit: number }
): Promise<string[]> {
  const results: string[] = [];
  await walkDirectory(directory, results, options);
  return results;
}

async function walkDirectory(
  directory: string,
  results: string[],
  options: { recursive: boolean; includeHidden: boolean; limit: number }
): Promise<void> {
  if (results.length >= options.limit) {
    return;
  }

  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!options.includeHidden && entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = resolve(directory, entry.name);
    results.push(fullPath);
    if (results.length >= options.limit) {
      return;
    }

    if (options.recursive && entry.isDirectory()) {
      await walkDirectory(fullPath, results, options);
      if (results.length >= options.limit) {
        return;
      }
    }
  }
}

export async function searchFiles(
  directory: string,
  query: string,
  options: { regex: boolean; limit: number; projectRoot: string }
): Promise<string[]> {
  const matches: string[] = [];
  const pattern = options.regex ? new RegExp(query, "g") : undefined;
  const files = await collectFiles(directory, {
    recursive: true,
    includeHidden: true,
    limit: 5_000
  });

  for (const filePath of files) {
    if (matches.length >= options.limit) {
      break;
    }

    try {
      const content = await readFile(filePath, "utf8");
      const lines = content.split("\n");
      lines.forEach((line, index) => {
        const lineMatches = pattern ? pattern.test(line) : line.includes(query);
        if (lineMatches && matches.length < options.limit) {
          matches.push(
            `${relative(options.projectRoot, filePath)}:${index + 1}:${line}`
          );
        }
      });
    } catch {
      // Ignore unreadable or binary files in the thin v1 scaffold.
    }
  }

  return matches;
}

export async function runChildProcess(
  command: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      signal,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolvePromise({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode
      });
    });
  });
}
