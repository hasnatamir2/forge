import type { AuthMode, ForgeConfig, ProviderConfig, ProviderKind } from "../config/schema.js";
import type { ForgeDatabase } from "../db/database.js";
import type { TSchema } from "@sinclair/typebox";
import type { ZodType } from "zod";

export type RunStatus = "running" | "awaiting_approval" | "completed" | "failed";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "consumed";
export type RiskLevel = "safe" | "guarded";

export type StepType =
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
  content: string;
  details?: unknown;
  isError?: boolean;
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

export interface ProviderRunResult {
  providerSessionFile: string | null;
  finalText: string;
  pauseRequested: boolean;
}

export interface AgentProvider {
  name: ProviderKind;
  runPrompt(input: {
    run: RunRecord;
    prompt: string;
    projectRoot: string;
    systemPrompt: string;
    config: ForgeConfig;
    providerConfig: ProviderConfig;
    database: ForgeDatabase;
    providerSessionFile?: string | null;
  }): Promise<ProviderRunResult>;
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
  content: string;
  details?: unknown;
  blocked?: boolean;
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
