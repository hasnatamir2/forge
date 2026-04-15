import { complete, getModel, type Message, type ToolCall } from "@mariozechner/pi-ai";
import type { ForgeConfig, ProviderConfig } from "../../config/schema.js";
import type { AgentProvider, ProviderRunResult } from "../types.js";
import { createToolRuntime } from "../../tools/index.js";
import { OpenAICodexAuthManager } from "./openai-codex-auth.js";

function mapThinkingLevel(thinkingLevel: ForgeConfig["agent"]["thinkingLevel"]) {
  switch (thinkingLevel) {
    case "off":
      return "none";
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
  }
}

export class OpenAICodexAgentProvider implements AgentProvider {
  readonly name = "openai-codex";

  constructor(private readonly authManager: OpenAICodexAuthManager) {}

  async runPrompt(input: {
    run: {
      id: string;
      providerSessionFile: string | null;
    };
    prompt: string;
    projectRoot: string;
    systemPrompt: string;
    config: ForgeConfig;
    providerConfig: ProviderConfig;
    database: import("../../db/database.js").ForgeDatabase;
    providerSessionFile?: string | null;
  }): Promise<ProviderRunResult> {
    if (input.providerConfig.kind !== "openai-codex") {
      throw new Error(
        `OpenAICodexAgentProvider cannot handle provider ${input.providerConfig.kind}`
      );
    }

    const apiKey = await this.authManager.resolveApiKey(input.projectRoot, input.providerConfig);
    const model = getModel("openai-codex", input.providerConfig.model as never);
    if (!model) {
      throw new Error(`OpenAI Codex model is not available: ${input.providerConfig.model}`);
    }

    const toolRuntime = createToolRuntime({
      runId: input.run.id,
      projectRoot: input.projectRoot,
      config: input.config,
      database: input.database
    });

    const messages: Message[] = [
      {
        role: "user",
        content: input.prompt,
        timestamp: Date.now()
      }
    ];
    let finalText = "";

    for (let iteration = 0; iteration < 24; iteration += 1) {
      const assistantMessage = await complete(
        model,
        {
          systemPrompt: input.systemPrompt,
          messages,
          tools: toolRuntime.toolDefinitions.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema
          }))
        },
        {
          apiKey,
          reasoningEffort: mapThinkingLevel(input.config.agent.thinkingLevel),
          sessionId: input.run.id
        }
      );

      messages.push(assistantMessage);

      const assistantText = assistantMessage.content
        .filter((content): content is { type: "text"; text: string } =>
          content.type === "text"
        )
        .map((content) => content.text)
        .join("\n")
        .trim();

      if (assistantText) {
        finalText = [finalText, assistantText].filter(Boolean).join("\n").trim();
        input.database.appendStep(input.run.id, "agent_message", {
          source: "assistant",
          eventType: "message",
          content: assistantText
        });
      }

      const toolCalls = assistantMessage.content.filter(
        (content): content is ToolCall => content.type === "toolCall"
      );

      if (toolCalls.length === 0) {
        return {
          providerSessionFile: null,
          finalText,
          pauseRequested: toolRuntime.state.pauseRequested
        };
      }

      for (const toolCall of toolCalls) {
        const toolResult = await toolRuntime.executeToolCall(
          toolCall.id,
          toolCall.name,
          toolCall.arguments
        );

        messages.push({
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [{ type: "text", text: toolResult.content }],
          details: toolResult.details,
          isError: false,
          timestamp: Date.now()
        });

        if (toolResult.blocked) {
          return {
            providerSessionFile: null,
            finalText,
            pauseRequested: true
          };
        }
      }
    }

    throw new Error("OpenAI Codex provider exceeded the maximum tool-iteration limit.");
  }
}
