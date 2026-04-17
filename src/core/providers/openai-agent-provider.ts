import type { ForgeConfig, ProviderConfig } from "../../config/schema.js";
import type {
  AgentConversationItem,
  AgentProvider,
  ProviderTurnResult,
  ResolvedAuthContext,
  ToolDefinition
} from "../types.js";
import { OpenAIAuthManager } from "./openai-auth.js";
import { resolveAuth } from "../auth-resolver.js";

interface ResponseOutputText {
  type: string;
  text?: string;
}

interface ResponseMessageItem {
  type: "message";
  role: "assistant" | "user" | "system";
  content: ResponseOutputText[];
}

interface ResponseFunctionCallItem {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

interface ResponsesApiResponse {
  id: string;
  output: Array<
    ResponseMessageItem | ResponseFunctionCallItem | Record<string, unknown>
  >;
  usage?: Record<string, unknown>;
}

export class OpenAIAgentProvider implements AgentProvider {
  readonly name = "openai";

  constructor(
    private readonly config: ForgeConfig,
    private readonly authManager: OpenAIAuthManager
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
    tools: ToolDefinition[];
  }): Promise<ProviderTurnResult> {
    if (input.providerConfig.kind !== "openai") {
      throw new Error(
        `OpenAIAgentProvider cannot handle provider ${input.providerConfig.kind}`
      );
    }

    const apiKey = authToApiKey(input.auth);
    const response = await this.createResponse({
      apiKey,
      instructions: input.systemPrompt,
      input: toResponsesInput(input.conversation),
      model: input.providerConfig.model,
      baseUrl: input.providerConfig.baseUrl,
      tools: input.tools
    });

    return {
      assistantMessage: extractAssistantText(response.output),
      toolCalls: response.output
        .filter(
          (item): item is ResponseFunctionCallItem =>
            item.type === "function_call"
        )
        .map((toolCall) => ({
          id: toolCall.call_id,
          name: toolCall.name,
          arguments: parseFunctionArguments(toolCall)
        })),
      finishReason: response.output.some(
        (item) => item.type === "function_call"
      )
        ? "tool_calls"
        : "stop",
      providerSessionFile: null,
      usage: extractUsage(response.usage)
    };
  }

  private async createResponse(input: {
    apiKey: string;
    baseUrl?: string;
    model: string;
    instructions: string;
    input: unknown[];
    tools: ToolDefinition[];
  }): Promise<ResponsesApiResponse> {
    const baseUrl = (input.baseUrl ?? "https://api.openai.com/v1").replace(
      /\/+$/,
      ""
    );
    const endpoint = baseUrl.endsWith("/v1")
      ? `${baseUrl}/responses`
      : `${baseUrl}/v1/responses`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: input.model,
        instructions: input.instructions,
        input: input.input,
        parallel_tool_calls: false,
        tools: input.tools.map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          strict: false
        }))
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI API request failed (${response.status}): ${errorText}`
      );
    }

    return (await response.json()) as ResponsesApiResponse;
  }
}

function authToApiKey(auth: ResolvedAuthContext): string {
  if (auth.kind !== "api_key") {
    throw new Error("OpenAI provider requires an API key auth context.");
  }

  return auth.value as string;
}

function toResponsesInput(conversation: AgentConversationItem[]): unknown[] {
  return conversation.map((item) => {
    switch (item.type) {
      case "user":
        return { role: "user", content: item.content };
      case "assistant":
        return { role: "assistant", content: item.content };
      case "tool_call":
        return {
          type: "function_call",
          call_id: item.id,
          name: item.name,
          arguments: JSON.stringify(item.arguments ?? {})
        };
      case "tool_result":
        return {
          type: "function_call_output",
          call_id: item.toolCallId,
          output: item.content
        };
    }
  });
}

function extractAssistantText(items: ResponsesApiResponse["output"]): string {
  const chunks: string[] = [];

  for (const item of items) {
    if (item.type !== "message" || item.role !== "assistant") {
      continue;
    }

    const contentItems = Array.isArray(item.content) ? item.content : [];
    for (const content of contentItems) {
      if (
        (content.type === "output_text" || content.type === "text") &&
        typeof content.text === "string"
      ) {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function parseFunctionArguments(item: ResponseFunctionCallItem): unknown {
  if (!item.arguments) {
    return {};
  }

  try {
    return JSON.parse(item.arguments);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Tool ${item.name} returned invalid JSON arguments: ${message}`
    );
  }
}

function extractUsage(usage: Record<string, unknown> | undefined):
  | {
      tokensIn?: number;
      tokensOut?: number;
    }
  | undefined {
  if (!usage) {
    return undefined;
  }

  const tokensIn = firstNumber(
    usage.input_tokens,
    usage.prompt_tokens,
    usage.inputTokens
  );
  const tokensOut = firstNumber(
    usage.output_tokens,
    usage.completion_tokens,
    usage.outputTokens
  );

  if (tokensIn === undefined && tokensOut === undefined) {
    return undefined;
  }

  return { tokensIn, tokensOut };
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}
