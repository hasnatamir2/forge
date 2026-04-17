import {
  complete,
  getModel,
  type Message,
  type ToolCall
} from "@mariozechner/pi-ai";
import type { ForgeConfig, ProviderConfig } from "../../config/schema.js";
import type {
  AgentConversationItem,
  AgentProvider,
  ProviderTurnResult,
  ResolvedAuthContext
} from "../types.js";
import { OpenAICodexAuthManager } from "./openai-codex-auth.js";
import { resolveAuth } from "../auth-resolver.js";

function mapThinkingLevel(
  thinkingLevel: ForgeConfig["agent"]["thinkingLevel"]
) {
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

  constructor(
    private readonly config: ForgeConfig,
    private readonly authManager: OpenAICodexAuthManager
  ) {}

  async resolveAuth(input: {
    projectRoot: string;
    providerConfig: ProviderConfig;
  }): Promise<ResolvedAuthContext> {
    return resolveAuth(input.providerConfig, this.config, input.projectRoot);
  }

  async completeTurn(input: {
    run: {
      id: string;
      providerSessionFile: string | null;
    };
    projectRoot: string;
    systemPrompt: string;
    config: ForgeConfig;
    providerConfig: ProviderConfig;
    auth: ResolvedAuthContext;
    conversation: AgentConversationItem[];
    tools: import("../types.js").ToolDefinition[];
  }): Promise<ProviderTurnResult> {
    if (input.providerConfig.kind !== "openai-codex") {
      throw new Error(
        `OpenAICodexAgentProvider cannot handle provider ${input.providerConfig.kind}`
      );
    }

    const apiKey = await this.authManager.resolveApiKeyFromAuth(
      input.projectRoot,
      input.auth
    );
    const model = getModel("openai-codex", input.providerConfig.model as never);
    if (!model) {
      throw new Error(
        `OpenAI Codex model is not available: ${input.providerConfig.model}`
      );
    }

    const assistantMessage = await complete(
      model,
      {
        systemPrompt: input.systemPrompt,
        messages: toPiMessages(input.conversation),
        tools: input.tools.map((tool) => ({
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

    return {
      assistantMessage: assistantMessage.content
        .filter(
          (content): content is { type: "text"; text: string } =>
            content.type === "text"
        )
        .map((content) => content.text)
        .join("\n")
        .trim(),
      toolCalls: assistantMessage.content
        .filter((content): content is ToolCall => content.type === "toolCall")
        .map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments
        })),
      finishReason: assistantMessage.content.some(
        (content) => content.type === "toolCall"
      )
        ? "tool_calls"
        : "stop",
      providerSessionFile: null
    };
  }
}

function toPiMessages(conversation: AgentConversationItem[]): Message[] {
  const messages: Message[] = [];
  let pendingAssistantContent: Array<
    | { type: "text"; text: string }
    | { type: "toolCall"; id: string; name: string; arguments: unknown }
  > = [];

  const flushAssistant = () => {
    if (pendingAssistantContent.length === 0) {
      return;
    }

    messages.push({
      role: "assistant",
      content: pendingAssistantContent,
      timestamp: Date.now()
    } as Message);
    pendingAssistantContent = [];
  };

  for (const item of conversation) {
    switch (item.type) {
      case "user":
        flushAssistant();
        messages.push({
          role: "user",
          content: item.content,
          timestamp: Date.now()
        } as Message);
        break;
      case "assistant":
        pendingAssistantContent.push({
          type: "text",
          text: item.content
        });
        break;
      case "tool_call":
        pendingAssistantContent.push({
          type: "toolCall",
          id: item.id,
          name: item.name,
          arguments: item.arguments
        });
        break;
      case "tool_result":
        flushAssistant();
        messages.push({
          role: "toolResult",
          toolCallId: item.toolCallId,
          toolName: item.toolName,
          content: [{ type: "text", text: item.content }],
          details: item.meta,
          isError: item.isError,
          timestamp: Date.now()
        } as Message);
        break;
    }
  }

  flushAssistant();
  return messages;
}
