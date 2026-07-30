import test from "node:test";
import assert from "node:assert/strict";
import {
  type AgentRuntime,
  type ControllerAdapters,
  type ControllerPolicy,
  type Evidence,
  type Handoff,
  type JournalEvent,
  type JournalStore,
  type RepositoryLease,
  type ReviewResult,
  type Task,
  type TaskTracker,
  type VerificationRunner,
  type WorkerResult,
  type Workspace,
  type WorkspaceManager,
  defaultPolicy,
} from "../src/domain.js";
import { ControllerCore } from "../src/core.js";

function policy(): ControllerPolicy {
  const result = defaultPolicy();
  result.roles.worker.model = "worker-model";
  result.roles.reviewer.model = "reviewer-model";
  result.protectedBranches = [];
  result.autoMerge = true;
  result.maxTasks = 10;
  result.maxAttemptsPerTask = 2;
  return result;
}

function task(number: number, priority: number): Task {
  return {
    number,
    title: `Task ${number}`,
    body: "",
    labels: ["ready-for-agent"],
    priority,
    state: "READY",
    acceptanceCriteria: [],
    dependencies: [],
  };
}

class MemoryJournal implements JournalStore {
  events: JournalEvent[] = [];
  async read(): Promise<JournalEvent[]> { return [...this.events]; }
  async append(event: JournalEvent): Promise<void> { this.events.push(event); }
}

class MemoryLease implements RepositoryLease {
  owner?: string;
  async acquire(runId: string): Promise<boolean> {
    if (this.owner && this.owner !== runId) return false;
    this.owner = runId;
    return true;
  }
  async release(runId: string): Promise<void> {
    if (this.owner === runId) this.owner = undefined;
  }
}

class FakeTasks implements TaskTracker {
  tasks: Task[];
  claimed: number[] = [];
  completed: number[] = [];
  constructor(tasks: Task[]) { this.tasks = tasks; }
  async listOpenTasks(): Promise<Task[]> { return this.tasks.filter((item) => !this.completed.includes(item.number)); }
  async claim(task: Task): Promise<void> { this.claimed.push(task.number); }
  async markReview(): Promise<void> {}
  async complete(task: Task): Promise<void> { this.completed.push(task.number); }
  async block(): Promise<void> {}
}

class FakeWorkspace implements WorkspaceManager {
  created: number[] = [];
  merged: number[] = [];
  async create(task: Task): Promise<Workspace> {
    this.created.push(task.number);
    return { taskNumber: task.number, path: `/tmp/task-${task.number}`, branch: `agent/task-${task.number}`, baseBranch: "main" };
  }
  async commit(): Promise<string> { return "commit-sha"; }
  async diff(): Promise<string> { return "diff"; }
  async merge(workspace: Workspace): Promise<{ commit: string }> {
    this.merged.push(workspace.taskNumber);
    return { commit: `merge-${workspace.taskNumber}` };
  }
  async cleanup(): Promise<void> {}
}

class FakeVerification implements VerificationRunner {
  calls = 0;
  succeeds = true;
  async run(workspace: Workspace): Promise<Evidence[]> {
    this.calls += 1;
    return [{ id: `verification-${workspace.taskNumber}`, kind: "verification", name: "tests", success: this.succeeds, output: this.succeeds ? "ok" : "failed", metadata: {} }];
  }
}

class FakeAgents implements AgentRuntime {
  workers = 0;
  reviewers = 0;
  async execute(role: "worker" | "reviewer", _handoff: Handoff, _signal: AbortSignal, _update?: (text: string) => void): Promise<WorkerResult | ReviewResult> {
    if (role === "worker") {
      this.workers += 1;
      return {
        schemaVersion: 1, outcome: "completed", changedFiles: ["src/change.ts"], commit: "worker-commit",
        testsClaimed: ["tests"], risks: [], blockers: [], recommendedDisposition: "verify",
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: 0.01, turns: 1 }, artifacts: [],
      };
    }
    this.reviewers += 1;
    return {
      schemaVersion: 1, disposition: "approved", findings: [], risks: [],
      usage: { input: 8, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: 0.01, turns: 1 }, artifacts: [],
    };
  }
}

function adapters(tasks: Task[]): { adapters: ControllerAdapters; tracker: FakeTasks; workspace: FakeWorkspace; verification: FakeVerification; agents: FakeAgents; journal: MemoryJournal } {
  const tracker = new FakeTasks(tasks);
  const workspace = new FakeWorkspace();
  const verification = new FakeVerification();
  const agents = new FakeAgents();
  const journal = new MemoryJournal();
  return {
    tracker, workspace, verification, agents, journal,
    adapters: { tasks: tracker, workspaces: workspace, verification, agents, journal, lease: new MemoryLease(), now: () => 1_000 },
  };
}

test("runs eligible tasks in deterministic order and immediately reconciles the next task", async () => {
  const setup = adapters([task(2, 2), task(1, 1)]);
  const core = new ControllerCore("/repo", policy(), setup.adapters);

  const result = await core.run(new AbortController().signal);

  assert.equal(result.run.stopReason, "BACKLOG_EMPTY");
  assert.deepEqual(setup.tracker.claimed, [1, 2]);
  assert.deepEqual(setup.workspace.created, [1, 2]);
  assert.deepEqual(setup.workspace.merged, [1, 2]);
  assert.equal(setup.verification.calls, 2);
  assert.equal(setup.agents.workers, 2);
  assert.equal(setup.agents.reviewers, 2);
  assert.ok(setup.journal.events.some((event) => event.type === "TASK_COMPLETED" && event.taskNumber === 2));
});

test("does not merge when review requests changes", async () => {
  const setup = adapters([task(1, 1)]);
  const original = setup.agents.execute.bind(setup.agents);
  let reviewCount = 0;
  setup.agents.execute = async (role, handoff, signal, update) => {
    const result = await original(role, handoff, signal, update);
    if (role === "reviewer" && reviewCount++ === 0) return { ...(result as ReviewResult), disposition: "changes_requested", findings: ["fix race"] };
    return result;
  };
  const customPolicy = policy();
  customPolicy.maxAttemptsPerTask = 1;
  const core = new ControllerCore("/repo", customPolicy, setup.adapters);

  const result = await core.run(new AbortController().signal);

  assert.equal(result.run.stopReason, "BLOCKED");
  assert.deepEqual(setup.workspace.merged, []);
  assert.ok(setup.journal.events.some((event) => event.type === "TASK_BLOCKED"));
});

test("stops at the task budget instead of silently starting another task", async () => {
  const setup = adapters([task(1, 1), task(2, 2)]);
  const customPolicy = policy();
  customPolicy.maxTasks = 1;
  const core = new ControllerCore("/repo", customPolicy, setup.adapters);

  const result = await core.run(new AbortController().signal);

  assert.equal(result.run.stopReason, "BUDGET_EXHAUSTED");
  assert.deepEqual(setup.tracker.completed, [1]);
  assert.deepEqual(setup.tracker.claimed, [1]);
});

test("does not merge when required verification fails", async () => {
  const setup = adapters([task(1, 1)]);
  setup.verification.succeeds = false;
  const customPolicy = policy();
  customPolicy.verification = [{ name: "tests", command: "tests", required: true }];
  const core = new ControllerCore("/repo", customPolicy, setup.adapters);

  const result = await core.run(new AbortController().signal);

  assert.equal(result.run.stopReason, "BLOCKED");
  assert.deepEqual(setup.workspace.merged, []);
  assert.ok(setup.journal.events.some((event) => event.type === "TASK_BLOCKED" && event.reason === "required verification failed"));
});

test("resumes a merge Human Gate without reclaiming or re-running the Task", async () => {
  const setup = adapters([task(1, 1)]);
  const customPolicy = policy();
  customPolicy.autoMerge = false;
  const core = new ControllerCore("/repo", customPolicy, setup.adapters);

  const waiting = await core.run(new AbortController().signal);
  assert.equal(waiting.run.stopReason, "HUMAN_DECISION_REQUIRED");
  assert.ok(waiting.run.gate);

  await core.approve(waiting.run.gate!.id, "allow");
  const completed = await core.run(new AbortController().signal);
  assert.equal(completed.run.stopReason, "BACKLOG_EMPTY");
  assert.deepEqual(setup.tracker.claimed, [1]);
  assert.deepEqual(setup.workspace.merged, [1]);
  assert.equal(setup.agents.workers, 1);
});

test("resumes from Verification Evidence without rerunning completed Worker work", async () => {
  const setup = adapters([task(1, 1)]);
  const worker: WorkerResult = {
    schemaVersion: 1, outcome: "completed", changedFiles: ["src/change.ts"], commit: "worker-commit", testsClaimed: [], risks: [], blockers: [], recommendedDisposition: "verify",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0, turns: 1 }, artifacts: [],
  };
  const evidence: Evidence = { id: "verification-1", kind: "verification", name: "tests", success: true, output: "ok", metadata: {} };
  setup.journal.events.push(
    { schemaVersion: 1, id: "run-phase:1", at: 100, type: "RUN_STARTED", runId: "run-phase" },
    { schemaVersion: 1, id: "run-phase:2", at: 101, type: "TASK_CLAIMED", runId: "run-phase", taskNumber: 1, data: { task: task(1, 1) } },
    { schemaVersion: 1, id: "run-phase:3", at: 102, type: "WORKSPACE_CREATED", runId: "run-phase", taskNumber: 1, data: { path: "/tmp/task-1", branch: "agent/task-1", baseBranch: "main" } },
    { schemaVersion: 1, id: "run-phase:4", at: 103, type: "EXECUTION_FINISHED", runId: "run-phase", taskNumber: 1, data: { result: worker } },
    { schemaVersion: 1, id: "run-phase:5", at: 104, type: "VERIFICATION_FINISHED", runId: "run-phase", taskNumber: 1, evidenceIds: [evidence.id], data: { evidence: [evidence], passed: true } },
  );
  const core = await ControllerCore.recover("/repo", policy(), setup.adapters);
  assert.ok(core);
  const result = await core.run(new AbortController().signal);
  assert.equal(result.run.stopReason, "BACKLOG_EMPTY");
  assert.equal(setup.agents.workers, 0);
  assert.equal(setup.agents.reviewers, 1);
  assert.equal(setup.verification.calls, 0);
});

test("recovers an interrupted Run in the existing Workspace without claiming twice", async () => {
  const setup = adapters([task(1, 1)]);
  setup.journal.events.push(
    { schemaVersion: 1, id: "run-1:1", at: 100, type: "RUN_STARTED", runId: "run-1" },
    { schemaVersion: 1, id: "run-1:2", at: 101, type: "TASK_CLAIMED", runId: "run-1", taskNumber: 1 },
    { schemaVersion: 1, id: "run-1:3", at: 102, type: "WORKSPACE_CREATED", runId: "run-1", taskNumber: 1, data: { path: "/tmp/task-1", branch: "agent/task-1", baseBranch: "main" } },
  );
  const core = await ControllerCore.recover("/repo", policy(), setup.adapters);
  assert.ok(core);

  const result = await core.run(new AbortController().signal);

  assert.equal(result.run.stopReason, "BACKLOG_EMPTY");
  assert.deepEqual(setup.tracker.claimed, []);
  assert.deepEqual(setup.workspace.created, []);
  assert.deepEqual(setup.workspace.merged, [1]);
});

test("requires a human decision before a guarded task can proceed", async () => {
  const setup = adapters([task(1, 1)]);
  const guarded = task(1, 1);
  guarded.title = "Change database migration";
  const tracker = new FakeTasks([guarded]);
  const core = new ControllerCore("/repo", policy(), { ...setup.adapters, tasks: tracker });

  const waiting = await core.run(new AbortController().signal);
  assert.equal(waiting.run.stopReason, "HUMAN_DECISION_REQUIRED");
  assert.equal(waiting.run.state, "PAUSED");
  assert.ok(waiting.run.gate);

  tracker.tasks.push(task(2, 0));
  await core.approve(waiting.run.gate!.id, "allow");
  const completed = await core.run(new AbortController().signal);
  assert.equal(completed.run.stopReason, "BACKLOG_EMPTY");
  assert.deepEqual(tracker.claimed, [1, 2]);
});

test("recovers a pending merge Human Gate without rerunning the Worker", async () => {
  const setup = adapters([task(1, 1)]);
  const customPolicy = policy();
  customPolicy.autoMerge = false;
  const worker: WorkerResult = {
    schemaVersion: 1, outcome: "completed", changedFiles: ["src/change.ts"], commit: "worker-commit", testsClaimed: [], risks: [], blockers: [], recommendedDisposition: "verify",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0, turns: 1 }, artifacts: [],
  };
  const evidence: Evidence = { id: "verification-1", kind: "verification", name: "tests", success: true, output: "ok", metadata: {} };
  const review: ReviewResult = { schemaVersion: 1, disposition: "approved", findings: [], risks: [], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0, turns: 1 }, artifacts: [] };
  setup.journal.events.push(
    { schemaVersion: 1, id: "run-3:1", at: 100, type: "RUN_STARTED", runId: "run-3" },
    { schemaVersion: 1, id: "run-3:2", at: 101, type: "TASK_CLAIMED", runId: "run-3", taskNumber: 1, data: { task: task(1, 1) } },
    { schemaVersion: 1, id: "run-3:3", at: 102, type: "WORKSPACE_CREATED", runId: "run-3", taskNumber: 1, data: { path: "/tmp/task-1", branch: "agent/task-1", baseBranch: "main" } },
    { schemaVersion: 1, id: "run-3:4", at: 103, type: "EXECUTION_FINISHED", runId: "run-3", taskNumber: 1, data: { result: worker } },
    { schemaVersion: 1, id: "run-3:5", at: 104, type: "VERIFICATION_FINISHED", runId: "run-3", taskNumber: 1, evidenceIds: [evidence.id], data: { evidence: [evidence], passed: true } },
    { schemaVersion: 1, id: "run-3:6", at: 105, type: "REVIEW_FINISHED", runId: "run-3", taskNumber: 1, data: { result: review, disposition: "approved" } },
    { schemaVersion: 1, id: "run-3:7", at: 106, type: "HUMAN_GATE_CREATED", runId: "run-3", taskNumber: 1, reason: "merge requires human approval", data: { gateId: "run-3:gate:1", kind: "merge", options: ["allow", "reject"] } },
  );
  const core = await ControllerCore.recover("/repo", customPolicy, setup.adapters);
  assert.ok(core);
  const waiting = await core.run(new AbortController().signal);
  assert.equal(waiting.run.stopReason, "HUMAN_DECISION_REQUIRED");
  await core.approve(waiting.run.gate!.id, "allow");
  const result = await core.run(new AbortController().signal);
  assert.equal(result.run.stopReason, "BACKLOG_EMPTY");
  assert.deepEqual(setup.tracker.claimed, []);
  assert.deepEqual(setup.workspace.merged, [1]);
  assert.equal(setup.agents.workers, 0);
});

test("recovers a paused Run from the journal", async () => {
  const setup = adapters([task(1, 1)]);
  setup.journal.events.push(
    { schemaVersion: 1, id: "run-2:1", at: 100, type: "RUN_STARTED", runId: "run-2" },
    { schemaVersion: 1, id: "run-2:2", at: 101, type: "TASK_CLAIMED", runId: "run-2", taskNumber: 1, data: { task: task(1, 1) } },
    { schemaVersion: 1, id: "run-2:3", at: 102, type: "WORKSPACE_CREATED", runId: "run-2", taskNumber: 1, data: { path: "/tmp/task-1", branch: "agent/task-1", baseBranch: "main" } },
    { schemaVersion: 1, id: "run-2:4", at: 103, type: "RUN_STOPPED", runId: "run-2", taskNumber: 1, reason: "pause requested", data: { stopReason: "PAUSED_BY_USER", paused: true } },
  );
  const core = await ControllerCore.recover("/repo", policy(), setup.adapters);
  assert.ok(core);
  const result = await core.run(new AbortController().signal);
  assert.equal(result.run.stopReason, "BACKLOG_EMPTY");
  assert.deepEqual(setup.tracker.claimed, []);
});
