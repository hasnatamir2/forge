import type { ForgeConfig, ProviderConfig } from "../../config/schema.js";
import type {
    AgentProvider,
    ProviderRunResult,
    ToolDefinition,
} from "../types.js";
import { createToolRuntime } from "../../tools/index.js";
import { OpenAIAuthManager } from "./openai-auth.js";

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
}

export class OpenAIAgentProvider implements AgentProvider {
    readonly name = "openai";

    constructor(private readonly authManager: OpenAIAuthManager) {}

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
        if (input.providerConfig.kind !== "openai") {
            throw new Error(
                `OpenAIAgentProvider cannot handle provider ${input.providerConfig.kind}`,
            );
        }

        const apiKey = await this.authManager.resolveApiKey(
            input.projectRoot,
            input.providerConfig,
        );
        const toolRuntime = createToolRuntime({
            runId: input.run.id,
            projectRoot: input.projectRoot,
            config: input.config,
            database: input.database,
        });

        const conversationItems: unknown[] = [
            { role: "user", content: input.prompt },
        ];
        let finalText = "";

        for (let iteration = 0; iteration < 24; iteration += 1) {
            const response = await this.createResponse({
                apiKey,
                instructions: input.systemPrompt,
                input: conversationItems,
                model: input.providerConfig.model,
                baseUrl: input.providerConfig.baseUrl,
                tools: toolRuntime.toolDefinitions,
            });

            conversationItems.push(...response.output);

            const assistantText = extractAssistantText(response.output);
            if (assistantText) {
                finalText = [finalText, assistantText]
                    .filter(Boolean)
                    .join("\n")
                    .trim();
                input.database.appendStep(input.run.id, "agent_message", {
                    source: "assistant",
                    eventType: "message",
                    content: assistantText,
                });
            }

            const functionCalls = response.output.filter(
                (item): item is ResponseFunctionCallItem =>
                    item.type === "function_call",
            );

            if (functionCalls.length === 0) {
                return {
                    providerSessionFile: null,
                    finalText,
                    pauseRequested: toolRuntime.state.pauseRequested,
                };
            }

            for (const functionCall of functionCalls) {
                const args = parseFunctionArguments(functionCall);
                const toolResult = await toolRuntime.executeToolCall(
                    functionCall.call_id,
                    functionCall.name,
                    args,
                );

                conversationItems.push({
                    type: "function_call_output",
                    call_id: functionCall.call_id,
                    output: toolResult.content,
                });

                if (toolResult.blocked) {
                    return {
                        providerSessionFile: null,
                        finalText,
                        pauseRequested: true,
                    };
                }
            }
        }

        throw new Error(
            "OpenAI provider exceeded the maximum tool-iteration limit.",
        );
    }

    private async createResponse(input: {
        apiKey: string;
        baseUrl?: string;
        model: string;
        instructions: string;
        input: unknown[];
        tools: ToolDefinition[];
    }): Promise<ResponsesApiResponse> {
        const baseUrl = (input.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
        const endpoint = baseUrl.endsWith("/v1") ? `${baseUrl}/responses` : `${baseUrl}/v1/responses`;
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${input.apiKey}`,
                "Content-Type": "application/json",
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
                    strict: false,
                })),
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                `OpenAI API request failed (${response.status}): ${errorText}`,
            );
        }

        return (await response.json()) as ResponsesApiResponse;
    }
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
            `Tool ${item.name} returned invalid JSON arguments: ${message}`,
        );
    }
}
