export const JOURNAL_SCHEMA_VERSION = 1 as const;
export const POLICY_SCHEMA_VERSION = 1 as const;

export type TaskState =
  | "READY"
  | "CLAIMED"
  | "RUNNING"
  | "VERIFYING"
  | "REVIEWING"
  | "MERGING"
  | "DONE"
  | "FAILED"
  | "BLOCKED"
  | "AWAITING_HUMAN"
  | "PAUSED"
  | "CANCELLED";

export type RunState = "RUNNING" | "PAUSED" | "STOPPED";

export type StopReason =
  | "BACKLOG_EMPTY"
  | "PAUSED_BY_USER"
  | "CANCELLED_BY_USER"
  | "HUMAN_DECISION_REQUIRED"
  | "BLOCKED"
  | "BUDGET_EXHAUSTED"
  | "CONFIGURATION_INVALID"
  | "LEASE_UNAVAILABLE"
  | "INTERNAL_FAILURE";

export type AgentRole = "worker" | "reviewer" | "architect";

export interface Task {
  number: number;
  title: string;
  body: string;
  labels: string[];
  priority: number;
  state: TaskState;
  acceptanceCriteria: string[];
  dependencies: number[];
  url?: string;
}

export interface VerificationCommand {
  name: string;
  command: string;
  args?: string[];
  timeoutMs?: number;
  required?: boolean;
  metricFile?: string;
  thresholds?: Record<string, { min?: number; max?: number }>;
}

export interface AgentRolePolicy {
  model: string;
  tools: string[];
  timeoutMs: number;
  agent?: string;
}

export interface ControllerPolicy {
  schemaVersion: typeof POLICY_SCHEMA_VERSION;
  readinessLabel: string;
  inProgressLabel: string;
  reviewLabel: string;
  blockedLabel: string;
  doneLabel: string;
  priorityLabels: Record<string, number>;
  requireAcceptanceCriteria: boolean;
  baseBranch: string;
  branchPrefix: string;
  workspaceRoot: string;
  autoMerge: boolean;
  closeIssueOnDone: boolean;
  requireHumanForMerge: boolean;
  maxTasks: number;
  maxAttemptsPerTask: number;
  maxRunDurationMs: number;
  maxTokens?: number;
  maxCost?: number;
  pollIntervalMs: number;
  verification: VerificationCommand[];
  roles: Record<AgentRole, AgentRolePolicy>;
  protectedBranches: string[];
  guardedPathPatterns: string[];
  cleanupOnSuccess: boolean;
  cleanupOnFailure: boolean;
  secrets?: string[];
}

export interface RoleUsage {
  input: number;
  output: number;
  tokens: number;
  cost: number;
  turns: number;
}

export interface RunBudgetUsage {
  completedTasks: number;
  attempts: number;
  tokens: number;
  cost: number;
  roleUsage: Record<AgentRole, RoleUsage>;
  startedAt: number;
}

export interface Run {
  id: string;
  projectRoot: string;
  state: RunState;
  phase: string;
  currentTask?: number;
  stopReason?: StopReason;
  gate?: HumanGate;
  usage: RunBudgetUsage;
  startedAt: number;
  updatedAt: number;
}

export interface Workspace {
  taskNumber: number;
  path: string;
  branch: string;
  baseBranch: string;
}

export interface Handoff {
  schemaVersion: 1;
  runId: string;
  task: Task;
  workspace: Workspace;
  role: AgentRole;
  model: string;
  tools: string[];
  constraints: string[];
  verification: VerificationCommand[];
  outputContract: string;
  evidence?: Evidence[];
  diff?: string;
  reviewFindings?: string[];
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
  turns: number;
}

export interface WorkerResult {
  schemaVersion: 1;
  outcome: "completed" | "failed" | "blocked" | "needs_human";
  changedFiles: string[];
  commit?: string;
  testsClaimed: string[];
  risks: string[];
  blockers: string[];
  recommendedDisposition: "verify" | "retry" | "blocked" | "human";
  usage: Usage;
  artifacts: string[];
}

export interface ReviewResult {
  schemaVersion: 1;
  disposition: "approved" | "changes_requested" | "blocked" | "needs_human";
  findings: string[];
  risks: string[];
  usage: Usage;
  artifacts: string[];
}

export interface Evidence {
  id: string;
  kind: "worker" | "verification" | "review" | "git" | "github" | "human";
  name: string;
  success: boolean;
  exitCode?: number;
  durationMs?: number;
  output: string;
  artifactPath?: string;
  metadata: Record<string, string | number | boolean>;
}

export interface HumanGate {
  id: string;
  kind: "task" | "merge";
  reason: string;
  options: string[];
  recommendation?: string;
  evidenceIds: string[];
  status: "pending" | "approved" | "rejected";
  decision?: string;
}

export type JournalEventType =
  | "RUN_STARTED"
  | "RUN_RESUMED"
  | "RUN_STOPPED"
  | "TASK_DISCOVERED"
  | "TASK_CLAIMING"
  | "TASK_CLAIMED"
  | "WORKSPACE_CREATING"
  | "WORKSPACE_CREATED"
  | "EXECUTION_STARTED"
  | "EXECUTION_FINISHED"
  | "VERIFICATION_FINISHED"
  | "REVIEW_FINISHED"
  | "HUMAN_GATE_CREATED"
  | "HUMAN_GATE_RESOLVED"
  | "TASK_MERGED"
  | "TASK_COMPLETED"
  | "TASK_FAILED"
  | "TASK_BLOCKED"
  | "TASK_CLEANUP_FAILED"
  | "TASK_PAUSED"
  | "LEASE_ACQUIRED"
  | "LEASE_RELEASED";

export interface JournalEvent {
  schemaVersion: typeof JOURNAL_SCHEMA_VERSION;
  id: string;
  at: number;
  type: JournalEventType;
  runId: string;
  taskNumber?: number;
  phase?: string;
  reason?: string;
  evidenceIds?: string[];
  data?: Record<string, unknown>;
}

export interface TaskTracker {
  listOpenTasks(): Promise<Task[]>;
  claim(task: Task, runId: string, label: string, marker: string): Promise<void>;
  markReview(task: Task, runId: string, label: string, marker: string): Promise<void>;
  complete(task: Task, runId: string, label: string, comment: string, marker: string): Promise<void>;
  block(task: Task, runId: string, label: string, comment: string, marker: string): Promise<void>;
}

export interface WorkspaceManager {
  create(task: Task, policy: ControllerPolicy): Promise<Workspace>;
  commit(task: Task, workspace: Workspace): Promise<string | undefined>;
  diff(workspace: Workspace): Promise<string>;
  merge(workspace: Workspace, policy: ControllerPolicy): Promise<{ commit?: string }>;
  cleanup(workspace: Workspace, policy: ControllerPolicy, success: boolean): Promise<void>;
  validate?(workspace: Workspace): Promise<boolean>;
  find?(task: Task, policy: ControllerPolicy): Promise<Workspace | undefined>;
}

export interface AgentRuntime {
  execute(
    role: AgentRole,
    handoff: Handoff,
    signal: AbortSignal,
    onUpdate?: (text: string) => void,
  ): Promise<WorkerResult | ReviewResult>;
}

export interface VerificationRunner {
  run(workspace: Workspace, commands: VerificationCommand[], signal: AbortSignal): Promise<Evidence[]>;
}

export interface JournalStore {
  read(): Promise<JournalEvent[]>;
  append(event: JournalEvent): Promise<void>;
}

export interface RepositoryLease {
  acquire(runId: string): Promise<boolean>;
  release(runId: string): Promise<void>;
}

export interface ControllerAdapters {
  tasks: TaskTracker;
  workspaces: WorkspaceManager;
  agents: AgentRuntime;
  verification: VerificationRunner;
  journal: JournalStore;
  lease: RepositoryLease;
  now?: () => number;
  id?: () => string;
}

export interface ReconcileResult {
  run: Run;
  events: JournalEvent[];
  evidence: Evidence[];
  actions: string[];
}

export function defaultPolicy(): ControllerPolicy {
  return {
    schemaVersion: POLICY_SCHEMA_VERSION,
    readinessLabel: "ready-for-agent",
    inProgressLabel: "agent-doing",
    reviewLabel: "agent-review",
    blockedLabel: "agent-blocked",
    doneLabel: "agent-done",
    priorityLabels: { "priority:p0": 0, "priority:p1": 1, "priority:p2": 2, "priority:p3": 3 },
    requireAcceptanceCriteria: false,
    baseBranch: "main",
    branchPrefix: "agent/task-",
    workspaceRoot: "../agent-workspaces",
    autoMerge: false,
    closeIssueOnDone: true,
    requireHumanForMerge: false,
    maxTasks: 10,
    maxAttemptsPerTask: 2,
    maxRunDurationMs: 4 * 60 * 60 * 1000,
    pollIntervalMs: 5_000,
    verification: [],
    roles: {
      worker: { model: "", tools: ["read", "bash", "edit", "write"], timeoutMs: 30 * 60 * 1000 },
      reviewer: { model: "", tools: ["read", "bash", "grep", "find", "ls"], timeoutMs: 15 * 60 * 1000 },
      architect: { model: "", tools: ["read", "grep", "find", "ls"], timeoutMs: 15 * 60 * 1000 },
    },
    protectedBranches: ["main", "master"],
    guardedPathPatterns: [".env", "production", "schema", "migration"],
    cleanupOnSuccess: true,
    cleanupOnFailure: false,
    secrets: [],
  };
}

export function taskFromIssue(input: {
  number: number;
  title: string;
  body?: string;
  labels?: string[];
  url?: string;
}, policy: ControllerPolicy): Task {
  const labels = input.labels ?? [];
  const priority = labels.reduce((best, label) => Math.min(best, policy.priorityLabels[label] ?? best), Number.MAX_SAFE_INTEGER);
  return {
    number: input.number,
    title: input.title,
    body: input.body ?? "",
    labels,
    priority: priority === Number.MAX_SAFE_INTEGER ? 100 : priority,
    state: "READY",
    acceptanceCriteria: extractAcceptanceCriteria(input.body ?? ""),
    dependencies: extractDependencies(input.body ?? ""),
    ...(input.url ? { url: input.url } : {}),
  };
}

function extractAcceptanceCriteria(body: string): string[] {
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  return lines
    .filter((line) => /^[-*]\s*\[[ xX]\]\s+/.test(line) || /^acceptance criteria\s*:/i.test(line))
    .map((line) => line.replace(/^[-*]\s*\[[ xX]\]\s+/, "").replace(/^acceptance criteria\s*:\s*/i, "").trim())
    .filter(Boolean);
}

function extractDependencies(body: string): number[] {
  const dependencies: number[] = [];
  for (const match of body.matchAll(/(?:depends on|blocked by|依赖)\s+#?(\d+)/gi)) {
    const number = Number(match[1]);
    if (Number.isSafeInteger(number)) dependencies.push(number);
  }
  return [...new Set(dependencies)];
}

export function validatePolicy(policy: ControllerPolicy): string[] {
  const errors: string[] = [];
  if (policy.schemaVersion !== POLICY_SCHEMA_VERSION) errors.push(`unsupported policy schema version: ${policy.schemaVersion}`);
  if (!policy.readinessLabel.trim()) errors.push("readinessLabel is required");
  if (!policy.baseBranch.trim()) errors.push("baseBranch is required");
  if (policy.maxTasks < 1) errors.push("maxTasks must be at least 1");
  if (policy.maxAttemptsPerTask < 1) errors.push("maxAttemptsPerTask must be at least 1");
  if (policy.maxRunDurationMs < 1) errors.push("maxRunDurationMs must be positive");
  if (policy.pollIntervalMs < 0) errors.push("pollIntervalMs cannot be negative");
  for (const role of ["worker", "reviewer"] as const) {
    if (!policy.roles[role]) errors.push(`missing ${role} role policy`);
    else if (!policy.roles[role].model.trim()) errors.push(`${role} model is required`);
    else if (policy.roles[role].timeoutMs < 1) errors.push(`${role} timeoutMs must be positive`);
  }
  return errors;
}

export function selectNextTask(tasks: Task[], policy: ControllerPolicy): Task | undefined {
  const numbers = new Set(tasks.map((task) => task.number));
  return tasks
    .filter((task) => task.state === "READY")
    .filter((task) => task.labels.includes(policy.readinessLabel))
    .filter((task) => !policy.requireAcceptanceCriteria || task.acceptanceCriteria.length > 0)
    .filter((task) => task.dependencies.every((dependency) => !numbers.has(dependency)))
    .sort((a, b) => a.priority - b.priority || a.number - b.number)[0];
}

export function isGuarded(task: Task, policy: ControllerPolicy): string | undefined {
  const text = `${task.title}\n${task.body}`.toLowerCase();
  return policy.guardedPathPatterns.find((pattern) => text.includes(pattern.toLowerCase()));
}

export function isBudgetExhausted(run: Run, policy: ControllerPolicy, now = Date.now()): boolean {
  return run.usage.completedTasks >= policy.maxTasks
    || run.usage.attempts >= policy.maxTasks * policy.maxAttemptsPerTask
    || now - run.startedAt >= policy.maxRunDurationMs
    || (policy.maxTokens !== undefined && run.usage.tokens >= policy.maxTokens)
    || (policy.maxCost !== undefined && run.usage.cost >= policy.maxCost);
}
