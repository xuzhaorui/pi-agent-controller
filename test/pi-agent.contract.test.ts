import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Handoff, Task, Usage, Workspace } from "../src/domain.js";
import { PiProcessAgentRuntime } from "../src/adapters/pi-agent.js";

// These tests exercise the real Pi JSON event-stream contract that
// PiProcessAgentRuntime parses. The event shapes below were captured from an
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

async function setup(scriptBody: string): Promise<{ runtime: PiProcessAgentRuntime; handoff: Handoff; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "pi-contract-"));
  const command = join(dir, "fake-pi");
  const events = join(dir, "events.jsonl");
  await writeFile(command, `#!/bin/sh\ncat "$FAKE_PI_EVENTS"\n`);
  await chmod(command, 0o755);
  await writeFile(events, scriptBody);
  const workspacePath = await mkdtemp(join(tmpdir(), "pi-ws-"));
  const workspace: Workspace = { taskNumber: 1, path: workspacePath, branch: "agent/task-1", baseBranch: "main" };
  const task: Task = { number: 1, title: "t", body: "", labels: ["ready-for-agent"], priority: 1, state: "READY", acceptanceCriteria: ["AC"], dependencies: [] };
  const handoff: Handoff = { schemaVersion: 1, runId: "run-1", task, workspace, role: "worker", model: "glm-5.2", tools: ["read", "bash", "edit", "write"], constraints: [], verification: [], outputContract: "WorkerResult" };
  const runtime = new PiProcessAgentRuntime({ command, environment: { FAKE_PI_EVENTS: events } });
  const cleanup = async () => { await rm(dir, { recursive: true, force: true }); await rm(workspacePath, { recursive: true, force: true }); };
  return { runtime, handoff, cleanup };
}

test("parses a Worker Result from the real Pi JSON event stream and normalises object-cost usage", async () => {
  const { runtime, handoff, cleanup } = await setup(stream([{ text: WORKER_JSON, usage: PI_USAGE }]));
  try {
    const result = await runtime.execute("worker", handoff, new AbortController().signal);
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

test("treats Pi message.usage as authoritative, ignoring the model's self-reported usage", async () => {
  const { runtime, handoff, cleanup } = await setup(stream([{ text: WORKER_JSON, usage: PI_USAGE }]));
  try {
    const result = await runtime.execute("worker", handoff, new AbortController().signal);
    assert.equal(result.usage.input, 442);
    assert.equal(result.usage.cost, 0.003);
    assert.notEqual(result.usage.cost, 999);
  } finally { await cleanup(); }
});

test("accumulates usage across multiple assistant turns", async () => {
  const turn2 = { ...PI_USAGE, input: 100, totalTokens: 120, cost: { ...PI_USAGE.cost, total: 0.004 } };
  const { runtime, handoff, cleanup } = await setup(stream([
    { text: "", usage: PI_USAGE },
    { text: WORKER_JSON, usage: turn2 },
  ]));
  try {
    const result = await runtime.execute("worker", handoff, new AbortController().signal);
    assert.equal(result.usage.input, 542);
    assert.equal(result.usage.totalTokens, 574);
    assert.equal(result.usage.cost, 0.007);
    assert.equal(result.usage.turns, 2);
  } finally { await cleanup(); }
});

test("fails when the assistant emits no Result text", async () => {
  const { runtime, handoff, cleanup } = await setup(stream([{ text: "", usage: PI_USAGE }]));
  try {
    await assert.rejects(runtime.execute("worker", handoff, new AbortController().signal), /did not return a JSON Result/);
  } finally { await cleanup(); }
});

test("fails on malformed Result JSON", async () => {
  const { runtime, handoff, cleanup } = await setup(stream([{ text: "not json at all", usage: PI_USAGE }]));
  try {
    await assert.rejects(runtime.execute("worker", handoff, new AbortController().signal), /malformed Result JSON/);
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
  const handoff: Handoff = { schemaVersion: 1, runId: "run-1", task, workspace, role: "worker", model: "m", tools: [], constraints: [], verification: [], outputContract: "WorkerResult" };
  const runtime = new PiProcessAgentRuntime({ command });
  try {
    await assert.rejects(runtime.execute("worker", handoff, new AbortController().signal), /Agent process failed/);
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
  const handoff: Handoff = { schemaVersion: 1, runId: "run-1", task, workspace, role: "worker", model: "m", tools: [], constraints: [], verification: [], outputContract: "WorkerResult" };
  const runtime = new PiProcessAgentRuntime({ command });
  const controller = new AbortController();
  const pending = assert.rejects(runtime.execute("worker", handoff, controller.signal), /cancelled/);
  controller.abort();
  await pending;
  await rm(dir, { recursive: true, force: true });
  await rm(workspacePath, { recursive: true, force: true });
});
