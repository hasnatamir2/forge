import { Type } from "@sinclair/typebox";
import { z as zod } from "zod";
import type { ForgeTool } from "../core/types.js";
import { assertWithinProjectRoot, isCommandAllowed } from "../core/policy.js";
import { runChildProcess } from "./shared.js";

const schema = zod.object({
  command: zod.string().min(1),
  args: zod.array(zod.string()).default([]),
  cwd: zod.string().optional()
});

export const runCommandTool: ForgeTool<zod.infer<typeof schema>> = {
  name: "run_command",
  description: "Run an allowlisted command inside the project root.",
  riskLevel: "guarded",
  zodSchema: schema,
  inputSchema: Type.Object({
    command: Type.String(),
    args: Type.Optional(Type.Array(Type.String())),
    cwd: Type.Optional(Type.String())
  }),
  summarize(args) {
    return `Run command ${[args.command, ...args.args].join(" ")}`;
  },
  async execute(args, context) {
    const allow = isCommandAllowed(context.config, args.command, args.args);
    if (!allow.allowed) {
      return {
        status: "error",
        content: allow.reason ?? `Command is not allowed: ${args.command}`
      };
    }

    const commandCwd = args.cwd
      ? assertWithinProjectRoot(context.projectRoot, args.cwd)
      : context.projectRoot;

    const result = await runChildProcess(
      args.command,
      args.args,
      commandCwd,
      context.signal
    );
    const content =
      result.stdout || result.stderr || "(command produced no output)";

    return {
      status: result.exitCode === 0 ? "ok" : "error",
      content,
      meta: {
        stderr: result.stderr,
        exitCode: result.exitCode
      }
    };
  }
};
