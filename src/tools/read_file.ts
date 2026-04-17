import { readFile } from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import { z as zod } from "zod";
import type { ForgeTool } from "../core/types.js";
import { assertWithinProjectRoot } from "../core/policy.js";

const schema = zod.object({
  path: zod.string(),
  startLine: zod.number().int().positive().optional(),
  endLine: zod.number().int().positive().optional(),
  maxBytes: zod.number().int().positive().max(100_000).default(50_000)
});

export const readFileTool: ForgeTool<zod.infer<typeof schema>> = {
  name: "read_file",
  description: "Read a file inside the project root with optional line bounds.",
  riskLevel: "safe",
  zodSchema: schema,
  inputSchema: Type.Object({
    path: Type.String(),
    startLine: Type.Optional(Type.Number()),
    endLine: Type.Optional(Type.Number()),
    maxBytes: Type.Optional(Type.Number({ default: 50000 }))
  }),
  summarize(args) {
    return `Read file ${args.path}`;
  },
  async execute(args, context) {
    const filePath = assertWithinProjectRoot(context.projectRoot, args.path);
    const content = await readFile(filePath, "utf8");
    const lines = content.split("\n");
    const startIndex = args.startLine ? Math.max(0, args.startLine - 1) : 0;
    const endIndex = args.endLine
      ? Math.min(lines.length, args.endLine)
      : lines.length;
    let selected = lines.slice(startIndex, endIndex).join("\n");

    if (Buffer.byteLength(selected, "utf8") > args.maxBytes) {
      selected = Buffer.from(selected, "utf8")
        .subarray(0, args.maxBytes)
        .toString("utf8");
      selected = `${selected}\n\n[truncated to ${args.maxBytes} bytes]`;
    }

    return {
      status: "ok",
      content: selected
    };
  }
};
