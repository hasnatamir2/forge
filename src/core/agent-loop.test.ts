import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "../config/define-config.js";
import type { ProviderConfig } from "../config/schema.js";
import { ForgeDatabase } from "../db/database.js";
import { runAgentLoop } from "./agent-loop.js";
import type {
  AgentConversationItem,
  AgentProvider,
  ProviderTurnResult,
  ResolvedAuthContext
} from "./types.js";

function createConfig() {
  return defineConfig({
    agent: {
      provider: {
        kind: "openai",
        authMode: "api_key",
        model: "gpt-5.4",
        apiKeyEnvVar: "OPENAI_API_KEY"
      },
      thinkingLevel: "medium",
      systemPromptFiles: []
    },
    runtime: {
      stateDir: ".forge",
      sqlitePath: ".forge/forge.db"
    },
    permissions: {
      projectRootMode: "cwd",
      commandAllowlist: []
    }
  });
}

class FakeProvider implements AgentProvider {
  readonly name = "openai";

  constructor(
    private readonly turns: Array<
      | ProviderTurnResult
      | ((conversation: AgentConversationItem[]) => ProviderTurnResult)
    >
  ) {}

  async resolveAuth(): Promise<ResolvedAuthContext> {
    return {
      kind: "api_key",
      value: "test-key",
      source: "config"
    };
  }

  async completeTurn(input: {
    conversation: AgentConversationItem[];
    providerConfig: ProviderConfig;
  }): Promise<ProviderTurnResult> {
    const next = this.turns.shift();
    if (!next) {
      throw new Error("No fake provider turn remaining");
    }

    return typeof next === "function" ? next(input.conversation) : next;
  }
}

test("agent loop completes after a single turn with no tools", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "forge-loop-single-"));
  const config = createConfig();
  const database = new ForgeDatabase(join(projectRoot, ".forge", "forge.db"));
  const run = database.createRun({
    prompt: "say hi",
    status: "running",
    model: "gpt-5.4",
    provider: "openai",
    providerAuthMode: "api_key",
    projectRoot
  });

  try {
    const result = await runAgentLoop({
      run,
      prompt: "say hi",
      projectRoot,
      systemPrompt: "system",
      config,
      providerConfig: config.agent.provider,
      provider: new FakeProvider([
        {
          assistantMessage: "hi",
          toolCalls: [],
          finishReason: "stop"
        }
      ]),
      database
    });

    assert.equal(result.pauseRequested, false);
    assert.equal(result.finalText, "hi");
    assert.equal(
      database.listSteps(run.id).filter((step) => step.type === "agent_message")
        .length,
      1
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("agent loop carries tool results into the next turn", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "forge-loop-safe-"));
  const config = createConfig();
  const database = new ForgeDatabase(join(projectRoot, ".forge", "forge.db"));
  const run = database.createRun({
    prompt: "inspect repo",
    status: "running",
    model: "gpt-5.4",
    provider: "openai",
    providerAuthMode: "api_key",
    projectRoot
  });

  await writeFile(join(projectRoot, "README.md"), "hello\n", "utf8");

  try {
    const provider = new FakeProvider([
      {
        assistantMessage: "Inspecting files",
        toolCalls: [
          {
            id: "tool-1",
            name: "list_files",
            arguments: {
              path: ".",
              recursive: false,
              includeHidden: false,
              limit: 10
            }
          }
        ],
        finishReason: "tool_calls"
      },
      (conversation) => {
        const toolResult = conversation.find(
          (item) => item.type === "tool_result"
        );
        assert.ok(toolResult);
        assert.equal(toolResult.type, "tool_result");
        assert.match(toolResult.content, /README\.md/);
        return {
          assistantMessage: "Done",
          toolCalls: [],
          finishReason: "stop"
        };
      }
    ]);

    const result = await runAgentLoop({
      run,
      prompt: "inspect repo",
      projectRoot,
      systemPrompt: "system",
      config,
      providerConfig: config.agent.provider,
      provider,
      database
    });

    assert.equal(result.pauseRequested, false);
    assert.equal(result.finalText, "Inspecting files\nDone");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("agent loop pauses when a guarded tool needs approval", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "forge-loop-guarded-"));
  const config = createConfig();
  const database = new ForgeDatabase(join(projectRoot, ".forge", "forge.db"));
  const run = database.createRun({
    prompt: "write a todo",
    status: "running",
    model: "gpt-5.4",
    provider: "openai",
    providerAuthMode: "api_key",
    projectRoot
  });

  try {
    const result = await runAgentLoop({
      run,
      prompt: "write a todo",
      projectRoot,
      systemPrompt: "system",
      config,
      providerConfig: config.agent.provider,
      provider: new FakeProvider([
        {
          assistantMessage: "Preparing the file",
          toolCalls: [
            {
              id: "tool-guarded",
              name: "write_file",
              arguments: {
                path: "TODO.md",
                content: "- test\n",
                mode: "create"
              }
            }
          ],
          finishReason: "tool_calls"
        }
      ]),
      database
    });

    assert.equal(result.pauseRequested, true);
    assert.equal(database.listApprovals(run.id).length, 1);
    const toolResults = database
      .listSteps(run.id)
      .filter((step) => step.type === "tool_result")
      .map((step) => JSON.parse(step.payloadJson));
    assert.equal(toolResults.at(-1)?.normalizedResultStatus, "blocked");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
