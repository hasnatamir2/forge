import type { ForgeConfig, ProviderConfig } from "../config/schema.js";
import type { ForgeDatabase } from "../db/database.js";
import { buildToolRuntime } from "../tools/index.js";
import type {
  AgentConversationItem,
  AgentLoopResult,
  AgentProvider,
  RunRecord
} from "./types.js";

export async function runAgentLoop(input: {
  run: RunRecord;
  prompt: string;
  projectRoot: string;
  systemPrompt: string;
  config: ForgeConfig;
  providerConfig: ProviderConfig;
  provider: AgentProvider;
  database: ForgeDatabase;
  providerSessionFile?: string | null;
}): Promise<AgentLoopResult> {
  const toolRuntime = buildToolRuntime({
    runId: input.run.id,
    projectRoot: input.projectRoot,
    config: input.config,
    database: input.database
  });
  const auth = await input.provider.resolveAuth({
    projectRoot: input.projectRoot,
    providerConfig: input.providerConfig
  });

  const conversation: AgentConversationItem[] = [
    {
      type: "user",
      content: input.prompt
    }
  ];
  let finalText = "";
  let providerSessionFile = input.providerSessionFile ?? null;
  let iteration = 0;

  while (true) {
    iteration += 1;
    const startedAt = Date.now();
    const turn = await input.provider.completeTurn({
      run: input.run,
      projectRoot: input.projectRoot,
      systemPrompt: input.systemPrompt,
      config: input.config,
      providerConfig: input.providerConfig,
      auth,
      conversation,
      tools: toolRuntime.toolDefinitions
    });

    if (turn.providerSessionFile !== undefined) {
      providerSessionFile = turn.providerSessionFile;
    }

    const assistantMessage = turn.assistantMessage.trim();
    const toolCallSummaries = turn.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.name
    }));

    input.database.appendStep(input.run.id, "agent_message", {
      source: "assistant",
      eventType: "turn",
      content: assistantMessage,
      finishReason: turn.finishReason,
      toolCalls: toolCallSummaries,
      durationMs: Date.now() - startedAt,
      tokensIn: turn.usage?.tokensIn ?? null,
      tokensOut: turn.usage?.tokensOut ?? null,
      iteration
    });

    if (assistantMessage) {
      finalText = [finalText, assistantMessage]
        .filter(Boolean)
        .join("\n")
        .trim();
      conversation.push({
        type: "assistant",
        content: assistantMessage
      });
    }

    if (turn.toolCalls.length === 0) {
      return {
        providerSessionFile,
        finalText,
        pauseRequested: toolRuntime.state.pauseRequested
      };
    }

    for (const toolCall of turn.toolCalls) {
      conversation.push({
        type: "tool_call",
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments
      });

      const toolResult = await toolRuntime.executeToolCall(
        toolCall.id,
        toolCall.name,
        toolCall.arguments
      );

      conversation.push({
        type: "tool_result",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: toolResult.content,
        meta: toolResult.meta,
        isError: toolResult.status === "error"
      });

      if (toolResult.status === "blocked") {
        return {
          providerSessionFile,
          finalText,
          pauseRequested: true
        };
      }
    }
  }
}
