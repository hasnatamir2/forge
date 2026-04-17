import { readFile, writeFile } from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import { z as zod } from "zod";
import type { ForgeTool } from "../core/types.js";
import { ensureFileParentAllowed } from "../core/policy.js";

const schema = zod.object({
  path: zod.string(),
  search: zod.string(),
  replace: zod.string(),
  all: zod.boolean().default(false)
});

export const applyPatchTool: ForgeTool<zod.infer<typeof schema>> = {
  name: "apply_patch",
  description:
    "Apply a deterministic search/replace patch to a file inside the project root.",
  riskLevel: "guarded",
  zodSchema: schema,
  inputSchema: Type.Object({
    path: Type.String(),
    search: Type.String(),
    replace: Type.String(),
    all: Type.Optional(Type.Boolean({ default: false }))
  }),
  summarize(args) {
    return `Apply patch to ${args.path}`;
  },
  async execute(args, context) {
    const filePath = ensureFileParentAllowed(context.projectRoot, args.path);
    const original = await readFile(filePath, "utf8");

    if (!original.includes(args.search)) {
      return {
        status: "error",
        content: `Search text not found in ${args.path}`
      };
    }

    const next = args.all
      ? original.split(args.search).join(args.replace)
      : original.replace(args.search, args.replace);

    await writeFile(filePath, next, "utf8");
    return {
      status: "ok",
      content: `Patched ${args.path}`
    };
  }
};
