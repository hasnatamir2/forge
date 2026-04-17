import { defineConfig } from "./src/config/define-config.js";

export default defineConfig({
  agent: {
    provider: {
      kind: "openai-codex",
      authMode: "login",
      model: "gpt-5.4",
      originator: "forge"
    },
    thinkingLevel: "medium",
    systemPromptFiles: ["./prompts/personality.md", "./AGENT.md"]
  },
  runtime: {
    stateDir: ".forge",
    sqlitePath: ".forge/forge.db"
  },
  permissions: {
    projectRootMode: "cwd",
    commandAllowlist: [
      {
        command: "git",
        argsPrefix: ["status"],
        description: "Inspect repository status"
      },
      {
        command: "git",
        argsPrefix: ["diff"],
        description: "Inspect repository diffs"
      },
      {
        command: "pnpm",
        argsPrefix: ["test"],
        description: "Run project tests"
      }
    ]
  }
});
