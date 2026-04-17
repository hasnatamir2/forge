import type {
  AuthMode,
  ForgeConfig,
  ProviderConfig,
  ProviderKind
} from "../config/schema.js";
import type { ForgeDatabase } from "../db/database.js";
import type { TSchema } from "@sinclair/typebox";
import type { ZodType } from "zod";

export type RunStatus =
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "consumed";
export type RiskLevel = "safe" | "guarded";

export type StepType =
  | "system_prompt"
  | "run_started"
  | "agent_message"
  | "tool_call_requested"
  | "tool_call_blocked"
  | "approval_created"
  | "approval_resolved"
  | "tool_call_executed"
  | "tool_result"
  | "run_completed"
  | "run_failed";

export interface RunRecord {
  id: string;
  prompt: string;
  status: RunStatus;
  model: string;
  provider: ProviderKind;
  providerAuthMode: AuthMode;
  projectRoot: string;
  providerSessionFile: string | null;
  createdAt: string;
  completedAt: string | null;
  finalOutput: string | null;
  errorMessage: string | null;
}

export interface StepRecord {
  id: string;
  runId: string;
  sequence: number;
  type: StepType;
  payloadJson: string;
  createdAt: string;
}

export interface ApprovalRecord {
  id: string;
  runId: string;
  stepId: string;
  toolName: string;
  argsJson: string;
  status: ApprovalStatus;
  reason: string | null;
  createdAt: string;
  resolvedAt: string | null;
  consumedAt: string | null;
}

export interface ForgeToolResult {
  status: "ok" | "error";
  content: string;
  meta?: unknown;
}

export interface ForgeToolContext {
  runId: string;
  projectRoot: string;
  config: ForgeConfig;
  database: ForgeDatabase;
  signal?: AbortSignal;
}

export interface ForgeTool<TArgs> {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  zodSchema: ZodType<TArgs>;
  inputSchema: TSchema;
  summarize(args: TArgs): string;
  execute(args: TArgs, context: ForgeToolContext): Promise<ForgeToolResult>;
}

export interface ProviderUsage {
  tokensIn?: number;
  tokensOut?: number;
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export type AgentConversationItem =
  | {
      type: "user";
      content: string;
    }
  | {
      type: "assistant";
      content: string;
    }
  | {
      type: "tool_call";
      id: string;
      name: string;
      arguments: unknown;
    }
  | {
      type: "tool_result";
      toolCallId: string;
      toolName: string;
      content: string;
      meta?: unknown;
      isError: boolean;
    };

export interface ResolvedAuthContext {
  kind: "api_key" | "session";
  value: string | Record<string, unknown>;
  source: "config" | "env" | "state_file";
  path?: string;
}

export interface ProviderTurnResult {
  assistantMessage: string;
  toolCalls: AgentToolCall[];
  finishReason?: string;
  providerSessionFile?: string | null;
  usage?: ProviderUsage;
}

export interface AgentProvider {
  name: ProviderKind;
  resolveAuth(input: {
    projectRoot: string;
    providerConfig: ProviderConfig;
  }): Promise<ResolvedAuthContext>;
  completeTurn(input: {
    run: RunRecord;
    projectRoot: string;
    systemPrompt: string;
    config: ForgeConfig;
    providerConfig: ProviderConfig;
    auth: ResolvedAuthContext;
    conversation: AgentConversationItem[];
    tools: ToolDefinition[];
  }): Promise<ProviderTurnResult>;
}

export interface AgentLoopResult {
  providerSessionFile: string | null;
  finalText: string;
  pauseRequested: boolean;
}

export interface ToolRuntimeState {
  pauseRequested: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: TSchema;
}

export interface ToolExecutionResult {
  status: "ok" | "error" | "blocked";
  content: string;
  meta?: unknown;
}

export interface ToolRuntime {
  toolDefinitions: ToolDefinition[];
  state: ToolRuntimeState;
  executeToolCall(
    toolCallId: string,
    toolName: string,
    rawArgs: unknown,
    signal?: AbortSignal
  ): Promise<ToolExecutionResult>;
}
