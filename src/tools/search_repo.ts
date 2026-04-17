import { Type } from "@sinclair/typebox";
import { z as zod } from "zod";
import type { ForgeTool } from "../core/types.js";
import { assertWithinProjectRoot } from "../core/policy.js";
import { searchFiles } from "./shared.js";

const schema = zod.object({
  query: zod.string().min(1),
  path: zod.string().default("."),
  regex: zod.boolean().default(false),
  limit: zod.number().int().positive().max(200).default(50)
});

export const searchRepoTool: ForgeTool<zod.infer<typeof schema>> = {
  name: "search_repo",
  description: "Search for text in repository files inside the project root.",
  riskLevel: "safe",
  zodSchema: schema,
  inputSchema: Type.Object({
    query: Type.String(),
    path: Type.Optional(Type.String({ default: "." })),
    regex: Type.Optional(Type.Boolean({ default: false })),
    limit: Type.Optional(Type.Number({ default: 50 }))
  }),
  summarize(args) {
    return `Search repo for ${JSON.stringify(args.query)}`;
  },
  async execute(args, context) {
    const basePath = assertWithinProjectRoot(context.projectRoot, args.path);
    const matches = await searchFiles(basePath, args.query, {
      regex: args.regex,
      limit: args.limit,
      projectRoot: context.projectRoot
    });

    return {
      status: "ok",
      content: matches.length > 0 ? matches.join("\n") : "(no matches found)"
    };
  }
};
