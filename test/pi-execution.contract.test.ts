import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExecutionEvent, ExecutionRequest, Handoff, Task, Usage, Workspace } from "../src/domain.js";
import { PiProcessExecutionRuntime } from "../src/adapters/pi-execution.js";

// These tests exercise the real Pi JSON event-stream contract that
// PiProcessExecutionRuntime parses. The event shapes below were captured from an
// actual `pi --mode json -p --no-session` invocation and document the wire
// format the adapter must keep working against.

interface AssistantEnd {
  text: string;
  usage: Record<string, unknown>;
}

function stream(ends: AssistantEnd[]): string {
  const lines: string[] = [
    `{"type":"session","version":3,"id":"t","timestamp":"2026-07-31T00:00:00.000Z","cwd":"/tmp"}`,
    `{"type":"agent_start"}`,
    `{"type":"turn_start"}`,
  ];
  for (const end of ends) {
    lines.push(`{"type":"message_start","message":{"role":"assistant","content":[]}}`);
    lines.push(
      `{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":${JSON.stringify(end.text)}}],"usage":${JSON.stringify(end.usage)},"stopReason":"stop"}}`,
    );
    lines.push(`{"type":"turn_end","message":{"role":"assistant"},"toolResults":[]}`);
  }
  lines.push(`{"type":"agent_end","messages":[]}`);
  lines.push(`{"type":"agent_settled"}`);
  return lines.join("\n");
}

const PI_USAGE = {
  input: 442,
  output: 12,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  totalTokens: 454,
  cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
};

const WORKER_JSON = JSON.stringify({
  schemaVersion: 1,
  outcome: "completed",
  changedFiles: ["src/a.ts"],
  commit: "abc123",
  testsClaimed: ["test"],
  risks: [],
  blockers: [],
  recommendedDisposition: "verify",
  usage: { input: 0, totalTokens: 0, cost: 999 }, // intentionally wrong/self-reported
  artifacts: [],
});

async function setup(scriptBody: string): Promise<{ runtime: PiProcessExecutionRuntime; request: ExecutionRequest; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "pi-contract-"));
  const command = join(dir, "fake-pi");
  const events = join(dir, "events.jsonl");
  await writeFile(command, `#!/bin/sh\ncat "$FAKE_PI_EVENTS"\n`);
  await chmod(command, 0o755);
  await writeFile(events, scriptBody);
  const workspacePath = await mkdtemp(join(tmpdir(), "pi-ws-"));
  const workspace: Workspace = { taskNumber: 1, path: workspacePath, branch: "agent/task-1", baseBranch: "main" };
  const task: Task = { number: 1, title: "t", body: "", labels: ["ready-for-agent"], priority: 1, state: "READY", acceptanceCriteria: ["AC"], dependencies: [] };
  const handoff: Handoff = { schemaVersion: 1, executionId: "execution-1", runId: "run-1", task, workspace, role: "worker", model: "glm-5.2", tools: ["read", "bash", "edit", "write"], constraints: [], verification: [], outputContract: "WorkerResult" };
  const runtime = new PiProcessExecutionRuntime({ command, environment: { FAKE_PI_EVENTS: events } });
  const cleanup = async () => { await rm(dir, { recursive: true, force: true }); await rm(workspacePath, { recursive: true, force: true }); };
  return { runtime, request: { id: handoff.executionId, role: handoff.role, handoff }, cleanup };
}

test("parses a Worker Result from the real Pi JSON event stream and normalises object-cost usage", async () => {
  const { runtime, request, cleanup } = await setup(stream([{ text: WORKER_JSON, usage: PI_USAGE }]));
  try {
    const result = await runtime.execute(request, new AbortController().signal);
    assert.equal(result.schemaVersion, 1);
    assert.equal((result as { outcome?: string }).outcome, "completed");
    assert.equal((result as { commit?: string }).commit, "abc123");
    const usage = result.usage as Usage;
    // usage must come from Pi's message.usage, with object cost normalised to a scalar.
    assert.equal(usage.input, 442);
    assert.equal(usage.totalTokens, 454);
    assert.equal(usage.cost, 0.003);
    assert.equal(usage.turns, 1);
  } finally { await cleanup(); }
});

test("normalises Pi lifecycle and tool activity into observable Execution Events", async () => {
  const toolEvents = [
    `{"type":"tool_execution_start","toolCallId":"call-1","toolName":"read","args":{"path":"README.md"}}`,
    `{"type":"tool_execution_end","toolCallId":"call-1","toolName":"read","result":{"content":[{"type":"text","text":"ok"}]},"isError":false}`,
  ].join("\n");
  const eventStream = stream([{ text: WORKER_JSON, usage: PI_USAGE }]).replace(`{"type":"turn_start"}`, `{"type":"turn_start"}\n${toolEvents}`);
  const { runtime, request, cleanup } = await setup(eventStream);
  const observed: ExecutionEvent[] = [];
  try {
    await runtime.execute(request, new AbortController().signal, (event) => { observed.push(event); });
    assert.deepEqual(runtime.capabilities, { cancel: true, pause: false, steer: false });
    assert.ok(observed.some((event) => event.type === "started"));
    assert.ok(observed.some((event) => event.type === "tool_call" && event.details?.toolName === "read"));
    assert.ok(observed.some((event) => event.type === "tool_result"));
    assert.ok(observed.some((event) => event.type === "usage"));
    assert.equal(observed.at(-1)?.type, "completed");
  } finally { await cleanup(); }
});

test("treats Pi message.usage as authoritative, ignoring the model's self-reported usage", async () => {
  const { runtime, request, cleanup } = await setup(stream([{ text: WORKER_JSON, usage: PI_USAGE }]));
  try {
    const result = await runtime.execute(request, new AbortController().signal);
    assert.equal(result.usage.input, 442);
    assert.equal(result.usage.cost, 0.003);
    assert.notEqual(result.usage.cost, 999);
  } finally { await cleanup(); }
});

test("accumulates usage across multiple assistant turns", async () => {
  const turn2 = { ...PI_USAGE, input: 100, totalTokens: 120, cost: { ...PI_USAGE.cost, total: 0.004 } };
  const { runtime, request, cleanup } = await setup(stream([
    { text: "", usage: PI_USAGE },
    { text: WORKER_JSON, usage: turn2 },
  ]));
  try {
    const result = await runtime.execute(request, new AbortController().signal);
    assert.equal(result.usage.input, 542);
    assert.equal(result.usage.totalTokens, 574);
    assert.equal(result.usage.cost, 0.007);
    assert.equal(result.usage.turns, 2);
  } finally { await cleanup(); }
});

test("fails when the assistant emits no Result text", async () => {
  const { runtime, request, cleanup } = await setup(stream([{ text: "", usage: PI_USAGE }]));
  try {
    await assert.rejects(runtime.execute(request, new AbortController().signal), /did not return a JSON Result/);
  } finally { await cleanup(); }
});

test("fails on malformed Result JSON", async () => {
  const { runtime, request, cleanup } = await setup(stream([{ text: "not json at all", usage: PI_USAGE }]));
  try {
    await assert.rejects(runtime.execute(request, new AbortController().signal), /malformed Result JSON/);
  } finally { await cleanup(); }
});

test("fails on non-zero process exit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-contract-"));
  const command = join(dir, "fake-pi");
  await writeFile(command, `#!/bin/sh\necho "boom" >&2\nexit 1\n`);
  await chmod(command, 0o755);
  const workspacePath = await mkdtemp(join(tmpdir(), "pi-ws-"));
  const workspace: Workspace = { taskNumber: 1, path: workspacePath, branch: "agent/task-1", baseBranch: "main" };
  const task: Task = { number: 1, title: "t", body: "", labels: [], priority: 1, state: "READY", acceptanceCriteria: [], dependencies: [] };
  const handoff: Handoff = { schemaVersion: 1, executionId: "execution-1", runId: "run-1", task, workspace, role: "worker", model: "m", tools: [], constraints: [], verification: [], outputContract: "WorkerResult" };
  const runtime = new PiProcessExecutionRuntime({ command });
  try {
    await assert.rejects(runtime.execute({ id: handoff.executionId, role: handoff.role, handoff }, new AbortController().signal), /Execution process failed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test("propagates AbortSignal by terminating the subprocess", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-contract-"));
  const command = join(dir, "fake-pi");
  await writeFile(command, `#!/bin/sh\nsleep 30\n`);
  await chmod(command, 0o755);
  const workspacePath = await mkdtemp(join(tmpdir(), "pi-ws-"));
  const workspace: Workspace = { taskNumber: 1, path: workspacePath, branch: "agent/task-1", baseBranch: "main" };
  const task: Task = { number: 1, title: "t", body: "", labels: [], priority: 1, state: "READY", acceptanceCriteria: [], dependencies: [] };
  const handoff: Handoff = { schemaVersion: 1, executionId: "execution-1", runId: "run-1", task, workspace, role: "worker", model: "m", tools: [], constraints: [], verification: [], outputContract: "WorkerResult" };
  const runtime = new PiProcessExecutionRuntime({ command });
  const controller = new AbortController();
  const pending = assert.rejects(runtime.execute({ id: handoff.executionId, role: handoff.role, handoff }, controller.signal), /cancelled/);
  controller.abort();
  await pending;
  await rm(dir, { recursive: true, force: true });
  await rm(workspacePath, { recursive: true, force: true });
});
