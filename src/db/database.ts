import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  drizzle,
  type BetterSQLite3Database
} from "drizzle-orm/better-sqlite3";
import type {
  ApprovalRecord,
  ApprovalStatus,
  RunRecord,
  RunStatus,
  StepRecord,
  StepType
} from "../core/types.js";
import type { AuthMode, ProviderKind } from "../config/schema.js";
import { createId } from "../utils/ids.js";
import {
  approvals,
  type ApprovalRow,
  runs,
  type RunRow,
  steps,
  type StepRow
} from "./schema.js";

function nowIso(): string {
  return new Date().toISOString();
}

function mapRun(row: RunRow): RunRecord {
  return {
    id: row.id,
    prompt: row.prompt,
    status: row.status as RunStatus,
    model: row.model,
    provider: row.provider as ProviderKind,
    providerAuthMode: row.providerAuthMode as AuthMode,
    projectRoot: row.projectRoot,
    providerSessionFile: row.providerSessionFile,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    finalOutput: row.finalOutput,
    errorMessage: row.errorMessage
  };
}

function mapStep(row: StepRow): StepRecord {
  return {
    id: row.id,
    runId: row.runId,
    sequence: row.sequence,
    type: row.type as StepType,
    payloadJson: row.payloadJson,
    createdAt: row.createdAt
  };
}

function mapApproval(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    runId: row.runId,
    stepId: row.stepId,
    toolName: row.toolName,
    argsJson: row.argsJson,
    status: row.status as ApprovalStatus,
    reason: row.reason,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    consumedAt: row.consumedAt
  };
}

export class ForgeDatabase {
  private readonly sqlite: Database.Database;
  private readonly orm: BetterSQLite3Database;

  constructor(filePath: string) {
    const resolvedPath = resolve(filePath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.sqlite = new Database(resolvedPath);
    this.sqlite.pragma("journal_mode = WAL");
    this.orm = drizzle(this.sqlite);
    this.migrate();
  }

  private migrate(): void {
    // Temporary bootstrap until Drizzle SQL migrations are generated.
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_auth_mode TEXT NOT NULL DEFAULT 'api_key',
        project_root TEXT NOT NULL,
        provider_session_file TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        final_output TEXT,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runs(id)
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        args_json TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        consumed_at TEXT,
        FOREIGN KEY(run_id) REFERENCES runs(id),
        FOREIGN KEY(step_id) REFERENCES steps(id)
      );
    `);

    this.ensureColumn(
      "runs",
      "provider_auth_mode",
      "TEXT NOT NULL DEFAULT 'api_key'"
    );
  }

  private ensureColumn(
    tableName: string,
    columnName: string,
    definition: string
  ): void {
    const rows = this.sqlite
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{
      name: string;
    }>;

    if (!rows.some((row) => row.name === columnName)) {
      this.sqlite.exec(
        `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`
      );
    }
  }

  createRun(input: {
    prompt: string;
    status: RunStatus;
    model: string;
    provider: ProviderKind;
    providerAuthMode: AuthMode;
    projectRoot: string;
  }): RunRecord {
    const run: RunRecord = {
      id: createId(),
      prompt: input.prompt,
      status: input.status,
      model: input.model,
      provider: input.provider,
      providerAuthMode: input.providerAuthMode,
      projectRoot: input.projectRoot,
      providerSessionFile: null,
      createdAt: nowIso(),
      completedAt: null,
      finalOutput: null,
      errorMessage: null
    };

    this.orm
      .insert(runs)
      .values({
        id: run.id,
        prompt: run.prompt,
        status: run.status,
        model: run.model,
        provider: run.provider,
        providerAuthMode: run.providerAuthMode,
        projectRoot: run.projectRoot,
        providerSessionFile: run.providerSessionFile,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        finalOutput: run.finalOutput,
        errorMessage: run.errorMessage
      })
      .run();

    return run;
  }

  getRun(runId: string): RunRecord | undefined {
    const row = this.orm.select().from(runs).where(eq(runs.id, runId)).get();
    return row ? mapRun(row) : undefined;
  }

  listRuns(): RunRecord[] {
    return this.orm
      .select()
      .from(runs)
      .orderBy(desc(runs.createdAt))
      .all()
      .map(mapRun);
  }

  updateRun(
    runId: string,
    patch: Partial<Omit<RunRecord, "id" | "createdAt">>
  ): void {
    const current = this.getRun(runId);
    if (!current) {
      throw new Error(`Run not found: ${runId}`);
    }

    const next: RunRecord = { ...current, ...patch };

    this.orm
      .update(runs)
      .set({
        prompt: next.prompt,
        status: next.status,
        model: next.model,
        provider: next.provider,
        providerAuthMode: next.providerAuthMode,
        projectRoot: next.projectRoot,
        providerSessionFile: next.providerSessionFile,
        completedAt: next.completedAt,
        finalOutput: next.finalOutput,
        errorMessage: next.errorMessage
      })
      .where(eq(runs.id, next.id))
      .run();
  }

  appendStep(runId: string, type: StepType, payload: unknown): StepRecord {
    const sequenceRow = this.orm
      .select({
        sequence: sql<number>`coalesce(max(${steps.sequence}), 0)`
      })
      .from(steps)
      .where(eq(steps.runId, runId))
      .get();

    const step: StepRecord = {
      id: createId(),
      runId,
      sequence: (sequenceRow?.sequence ?? 0) + 1,
      type,
      payloadJson: JSON.stringify(payload),
      createdAt: nowIso()
    };

    this.orm
      .insert(steps)
      .values({
        id: step.id,
        runId: step.runId,
        sequence: step.sequence,
        type: step.type,
        payloadJson: step.payloadJson,
        createdAt: step.createdAt
      })
      .run();

    return step;
  }

  listSteps(runId: string): StepRecord[] {
    return this.orm
      .select()
      .from(steps)
      .where(eq(steps.runId, runId))
      .orderBy(asc(steps.sequence))
      .all()
      .map(mapStep);
  }

  createApproval(input: {
    runId: string;
    stepId: string;
    toolName: string;
    argsJson: string;
    reason: string;
  }): ApprovalRecord {
    const approval: ApprovalRecord = {
      id: createId(),
      runId: input.runId,
      stepId: input.stepId,
      toolName: input.toolName,
      argsJson: input.argsJson,
      status: "pending",
      reason: input.reason,
      createdAt: nowIso(),
      resolvedAt: null,
      consumedAt: null
    };

    this.orm
      .insert(approvals)
      .values({
        id: approval.id,
        runId: approval.runId,
        stepId: approval.stepId,
        toolName: approval.toolName,
        argsJson: approval.argsJson,
        status: approval.status,
        reason: approval.reason,
        createdAt: approval.createdAt,
        resolvedAt: approval.resolvedAt,
        consumedAt: approval.consumedAt
      })
      .run();

    return approval;
  }

  getApproval(approvalId: string): ApprovalRecord | undefined {
    const row = this.orm
      .select()
      .from(approvals)
      .where(eq(approvals.id, approvalId))
      .get();
    return row ? mapApproval(row) : undefined;
  }

  listApprovals(runId?: string): ApprovalRecord[] {
    const query = this.orm.select().from(approvals);
    const rows = runId
      ? query
          .where(eq(approvals.runId, runId))
          .orderBy(desc(approvals.createdAt))
          .all()
      : query.orderBy(desc(approvals.createdAt)).all();
    return rows.map(mapApproval);
  }

  resolveApproval(
    approvalId: string,
    status: Extract<ApprovalStatus, "approved" | "rejected">,
    reason?: string
  ): ApprovalRecord {
    const approval = this.getApproval(approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`);
    }

    const resolvedAt = nowIso();
    this.orm
      .update(approvals)
      .set({
        status,
        reason: reason ?? approval.reason,
        resolvedAt
      })
      .where(eq(approvals.id, approvalId))
      .run();

    return {
      ...approval,
      status,
      reason: reason ?? approval.reason,
      resolvedAt
    };
  }

  markApprovalConsumed(approvalId: string): void {
    this.orm
      .update(approvals)
      .set({
        status: "consumed",
        consumedAt: nowIso()
      })
      .where(eq(approvals.id, approvalId))
      .run();
  }

  findApprovedApproval(
    runId: string,
    toolName: string,
    argsJson: string
  ): ApprovalRecord | undefined {
    const row = this.orm
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.runId, runId),
          eq(approvals.toolName, toolName),
          eq(approvals.argsJson, argsJson),
          eq(approvals.status, "approved")
        )
      )
      .orderBy(asc(approvals.createdAt))
      .get();

    return row ? mapApproval(row) : undefined;
  }
}
