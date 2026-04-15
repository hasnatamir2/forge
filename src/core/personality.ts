import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function buildSystemPrompt(projectRoot: string, files: string[]): Promise<string> {
  const sections: string[] = [];

  for (const filePath of files) {
    const resolvedPath = resolve(projectRoot, filePath);
    const content = await readFile(resolvedPath, "utf8");
    sections.push(`# Source: ${filePath}\n\n${content.trim()}`);
  }

  return sections.join("\n\n");
}
