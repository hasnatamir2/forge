import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  prompt: text("prompt").notNull(),
  status: text("status").notNull(),
  model: text("model").notNull(),
  provider: text("provider").notNull(),
  providerAuthMode: text("provider_auth_mode").notNull(),
  projectRoot: text("project_root").notNull(),
  providerSessionFile: text("provider_session_file"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
  finalOutput: text("final_output"),
  errorMessage: text("error_message")
});

export const steps = sqliteTable("steps", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  sequence: integer("sequence").notNull(),
  type: text("type").notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: text("created_at").notNull()
});

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  stepId: text("step_id")
    .notNull()
    .references(() => steps.id),
  toolName: text("tool_name").notNull(),
  argsJson: text("args_json").notNull(),
  status: text("status").notNull(),
  reason: text("reason"),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
  consumedAt: text("consumed_at")
});

export type RunRow = typeof runs.$inferSelect;
export type StepRow = typeof steps.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
