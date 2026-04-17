import { relative } from "node:path";
import { Type } from "@sinclair/typebox";
import { z as zod } from "zod";
import type { ForgeTool } from "../core/types.js";
import { assertWithinProjectRoot } from "../core/policy.js";
import { collectFiles } from "./shared.js";

const schema = zod.object({
  path: zod.string().default("."),
  recursive: zod.boolean().default(false),
  includeHidden: zod.boolean().default(false),
  limit: zod.number().int().positive().max(500).default(200)
});

export const listFilesTool: ForgeTool<zod.infer<typeof schema>> = {
  name: "list_files",
  description: "List files under a path within the project root.",
  riskLevel: "safe",
  zodSchema: schema,
  inputSchema: Type.Object({
    path: Type.Optional(Type.String({ default: "." })),
    recursive: Type.Optional(Type.Boolean({ default: false })),
    includeHidden: Type.Optional(Type.Boolean({ default: false })),
    limit: Type.Optional(Type.Number({ default: 200 }))
  }),
  summarize(args) {
    return `List files in ${args.path}`;
  },
  async execute(args, context) {
    const basePath = assertWithinProjectRoot(context.projectRoot, args.path);
    const entries = await collectFiles(basePath, {
      recursive: args.recursive,
      includeHidden: args.includeHidden,
      limit: args.limit
    });

    const relativeEntries = entries.map(
      (entry) => relative(context.projectRoot, entry) || "."
    );
    return {
      status: "ok",
      content: relativeEntries.join("\n") || "(no files found)"
    };
  }
};
