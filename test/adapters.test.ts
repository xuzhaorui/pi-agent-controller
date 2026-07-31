import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileJournal } from "../src/adapters/journal.js";
import { FileRepositoryLease } from "../src/adapters/lease.js";
import { GitWorkspaceManager } from "../src/adapters/git.js";
import { parseGitHubRepo, GitHubIssueTracker } from "../src/adapters/github.js";
import { LocalVerificationRunner } from "../src/adapters/verification.js";
import { type CommandRunner, type CommandResult } from "../src/adapters/command.js";
import { defaultPolicy, type Task } from "../src/domain.js";

const run = async (command: string, args: string[], cwd: string): Promise<void> => {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const process = spawn(command, args, { cwd, stdio: "ignore" });
    process.on("error", reject);
    process.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed: ${code}`)));
  });
};

test("persists and reloads the append-only Run Journal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "controller-journal-"));
  try {
    const journal = new FileJournal(join(dir, "journal.jsonl"));
    await journal.append({ schemaVersion: 1, id: "1", at: 1, type: "RUN_STARTED", runId: "run-1" });
    await journal.append({ schemaVersion: 1, id: "2", at: 2, type: "RUN_STOPPED", runId: "run-1", reason: "test" });
    assert.deepEqual((await journal.read()).map((event) => event.type), ["RUN_STARTED", "RUN_STOPPED"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("allows only one live repository lease and releases it by owner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "controller-lease-"));
  try {
    const path = join(dir, "lease.json");
    const first = new FileRepositoryLease(path, process.pid);
    const second = new FileRepositoryLease(path, process.pid + 1);
    assert.equal(await first.acquire("run-1"), true);
    assert.equal(await second.acquire("run-2"), false);
    await second.release("run-2");
    await first.release("run-1");
    assert.equal(await second.acquire("run-2"), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("resolves GitHub remotes without accepting other hosts", () => {
  assert.equal(parseGitHubRepo("git@github.com:xuzhaorui/pi-agent-controller.git"), "xuzhaorui/pi-agent-controller");
  assert.equal(parseGitHubRepo("https://github.com/xuzhaorui/pi-agent-controller"), "xuzhaorui/pi-agent-controller");
  assert.equal(parseGitHubRepo("https://gitlab.com/xuzhaorui/pi-agent-controller"), undefined);
});

test("creates a safe isolated Git Worktree from a clean repository", async () => {
  const dir = await mkdtemp(join(tmpdir(), "controller-git-"));
  const workspaceRoot = await mkdtemp(join(tmpdir(), "controller-workspaces-"));
  try {
    await run("git", ["init", "-b", "main"], dir);
    await run("git", ["config", "user.email", "test@example.com"], dir);
    await run("git", ["config", "user.name", "Test"], dir);
    await writeFile(join(dir, "README.md"), "base\n");
    await run("git", ["add", "."], dir);
    await run("git", ["commit", "-m", "base"], dir);
    const policy = defaultPolicy();
    policy.workspaceRoot = workspaceRoot;
    const task: Task = { number: 7, title: "dangerous title ; rm", body: "", labels: [policy.readinessLabel], priority: 1, state: "READY", acceptanceCriteria: [], dependencies: [] };
    const manager = new GitWorkspaceManager(dir);
    const workspace = await manager.create(task, policy);
    assert.equal(workspace.branch, "agent/task-7");
    assert.equal(await readFile(join(workspace.path, "README.md"), "utf8"), "base\n");
    assert.equal(await manager.validate(workspace), true);
    await manager.cleanup(workspace, { ...policy, cleanupOnSuccess: true }, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("redacts generic credential patterns before persisting verification output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "controller-redact-"));
  try {
    const commands: CommandRunner = { run: async () => ({ stdout: "token=TOPSECRET", stderr: "", code: 0, killed: false }) };
    const runner = new LocalVerificationRunner(dir, commands);
    const evidence = await runner.run({ taskNumber: 3, path: dir, branch: "agent/task-3", baseBranch: "main" }, [{ name: "secret", command: "ignored", required: true }], new AbortController().signal);
    assert.ok(!evidence[0]!.output.includes("TOPSECRET"));
    assert.ok(!(await readFile(evidence[0]!.artifactPath!, "utf8")).includes("TOPSECRET"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("keeps verification output bounded and stores the full artifact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "controller-verify-"));
  try {
    const output = "x".repeat(60_000);
    const commands: CommandRunner = { run: async () => ({ stdout: output, stderr: "", code: 0, killed: false }) };
    const runner = new LocalVerificationRunner(dir, commands);
    const evidence = await runner.run({ taskNumber: 2, path: dir, branch: "agent/task-2", baseBranch: "main" }, [{ name: "large", command: "ignored", required: true }], new AbortController().signal);
    assert.equal(evidence[0]?.success, true);
    assert.ok((evidence[0]?.output.length ?? 0) < output.length);
    assert.ok(evidence[0]?.artifactPath);
    assert.equal((await readFile(evidence[0]!.artifactPath!, "utf8")).length, output.length);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

class StubCommands implements CommandRunner {
  constructor(private readonly stdout: string, private readonly code = 0, private readonly stderr = "") {}
  async run(): Promise<CommandResult> { return { stdout: this.stdout, stderr: this.stderr, code: this.code, killed: false }; }
}

test("parses gh issue list --json output with multiline bodies and maps labels to Task state", async () => {
  const gh = [
    { number: 5, title: "Task", body: "intro\n\n## Acceptance Criteria\n- [ ] AC one\n- [ ] AC two", labels: [{ name: "ready-for-agent" }], url: "https://github.com/x/r/issues/5" },
    { number: 7, title: "WIP", body: "", labels: [{ name: "agent-doing" }], url: "https://github.com/x/r/issues/7" },
    { number: 9, title: "Review", body: "", labels: [{ name: "agent-review" }], url: "https://github.com/x/r/issues/9" },
  ];
  const policy = defaultPolicy();
  const tracker = new GitHubIssueTracker("x/r", policy, new StubCommands(JSON.stringify(gh)));
  const tasks = await tracker.listOpenTasks();
  assert.equal(tasks.length, 3);
  const ready = tasks[0]!;
  const wip = tasks[1]!;
  const review = tasks[2]!;
  assert.equal(ready.number, 5);
  assert.equal(ready.state, "READY");
  assert.deepEqual(ready.acceptanceCriteria, ["AC one", "AC two"]);
  assert.equal(wip.state, "CLAIMED");
  assert.equal(review.state, "REVIEWING");
});

test("fails when gh issue discovery exits non-zero or returns malformed JSON", async () => {
  const policy = defaultPolicy();
  await assert.rejects(new GitHubIssueTracker("x/r", policy, new StubCommands("", 1, "not authenticated")).listOpenTasks(), /not authenticated/);
  await assert.rejects(new GitHubIssueTracker("x/r", policy, new StubCommands("not an array")).listOpenTasks(), /malformed JSON/);
  await assert.rejects(new GitHubIssueTracker("x/r", policy, new StubCommands("{}", 0)).listOpenTasks(), /malformed JSON/);
});
