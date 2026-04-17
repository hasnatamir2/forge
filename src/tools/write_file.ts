import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "@sinclair/typebox";
import { z as zod } from "zod";
import type { ForgeTool } from "../core/types.js";
import { ensureFileParentAllowed } from "../core/policy.js";

const schema = zod.object({
  path: zod.string(),
  content: zod.string(),
  mode: zod.enum(["overwrite", "append", "create"]).default("overwrite")
});

export const writeFileTool: ForgeTool<zod.infer<typeof schema>> = {
  name: "write_file",
  description: "Write content to a file inside the project root.",
  riskLevel: "guarded",
  zodSchema: schema,
  inputSchema: Type.Object({
    path: Type.String(),
    content: Type.String(),
    mode: Type.Optional(
      Type.Union([
        Type.Literal("overwrite"),
        Type.Literal("append"),
        Type.Literal("create")
      ])
    )
  }),
  summarize(args) {
    return `Write file ${args.path} (${args.mode})`;
  },
  async execute(args, context) {
    const filePath = ensureFileParentAllowed(context.projectRoot, args.path);
    await mkdir(dirname(filePath), { recursive: true });

    if (args.mode === "create" && existsSync(filePath)) {
      return {
        status: "error",
        content: `File already exists: ${args.path}`
      };
    }

    if (args.mode === "append") {
      const existing = existsSync(filePath)
        ? await readFile(filePath, "utf8")
        : "";
      await writeFile(filePath, `${existing}${args.content}`, "utf8");
    } else {
      await writeFile(filePath, args.content, "utf8");
    }

    return {
      status: "ok",
      content: `Wrote ${args.path}`
    };
  }
};
