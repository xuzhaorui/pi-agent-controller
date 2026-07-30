import { resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ControllerCore } from "./core.js";
import { loadPolicy } from "./config.js";
import { defaultPolicy, selectNextTask, type ControllerPolicy, type ReconcileResult, type Run } from "./domain.js";
import { LocalCommandRunner } from "./adapters/command.js";
import { GitHubIssueTracker, parseGitHubRepo } from "./adapters/github.js";
import { GitWorkspaceManager } from "./adapters/git.js";
import { FileJournal } from "./adapters/journal.js";
import { FileRepositoryLease } from "./adapters/lease.js";
import { PiProcessAgentRuntime } from "./adapters/pi-agent.js";
import { LocalVerificationRunner } from "./adapters/verification.js";

export class ControllerService {
  private core?: ControllerCore;
  private running?: Promise<ReconcileResult>;
  private lastResult?: ReconcileResult;
  private projectRoot?: string;
  private policy?: ControllerPolicy;

  async start(ctx: ExtensionContext, dryRun = false): Promise<Run | ReconcileResult | undefined> {
    if (this.running) return this.core?.snapshot;
    const setup = await this.setup(ctx);
    if (dryRun) {
      const tasks = await setup.tasks.listOpenTasks();
      const next = selectNextTask(tasks, setup.policy);
      return next ? { run: this.core?.snapshot ?? makePreviewRun(setup.projectRoot), events: [], evidence: [], actions: [`next task #${next.number}: ${next.title}`] } : { run: makePreviewRun(setup.projectRoot), events: [], evidence: [], actions: ["BACKLOG_EMPTY"] };
    }
    this.core = await ControllerCore.recover(setup.projectRoot, setup.policy, setup.adapters) ?? new ControllerCore(setup.projectRoot, setup.policy, setup.adapters);
    return this.launch();
  }

  async resume(ctx: ExtensionContext): Promise<Run | ReconcileResult | undefined> {
    if (this.core && !this.running) return this.launch();
    return this.start(ctx, false);
  }

  async pause(): Promise<void> { await this.core?.pause(); }

  async stop(): Promise<void> { await this.core?.stopNow(); }

  async approve(gateId: string, decision: string, ctx: ExtensionContext): Promise<Run | ReconcileResult | undefined> {
    if (!this.core || !await this.core.approve(gateId, decision)) return undefined;
    return this.resume(ctx);
  }

  status(): Run | undefined { return this.core?.snapshot ?? this.lastResult?.run; }

  async shutdown(): Promise<void> {
    await this.core?.stopNow();
    await this.running;
    this.running = undefined;
    this.core = undefined;
  }

  private launch(): Run {
    if (!this.core) throw new Error("Controller is not initialized");
    let promise: Promise<ReconcileResult>;
    promise = this.core.run(new AbortController().signal).then((result) => {
      this.lastResult = result;
      return result;
    }).finally(() => {
      if (this.running === promise) this.running = undefined;
    });
    this.running = promise;
    void promise.catch(() => { /* the Core journals runtime failures */ });
    return this.core.snapshot;
  }

  private async setup(ctx: ExtensionContext): Promise<{ projectRoot: string; policy: ControllerPolicy; tasks: GitHubIssueTracker; adapters: ConstructorParameters<typeof ControllerCore>[2] }> {
    const commands = new LocalCommandRunner();
    const rootResult = await commands.run("git", ["rev-parse", "--show-toplevel"], { cwd: ctx.cwd, timeoutMs: 10_000 });
    if (rootResult.code !== 0) throw new Error("current directory is not a Git repository");
    const projectRoot = rootResult.stdout.trim();
    const policy = await loadPolicy(projectRoot);
    const remoteResult = await commands.run("git", ["remote", "-v"], { cwd: projectRoot, timeoutMs: 10_000 });
    const remote = remoteResult.stdout.split(/\r?\n/).map((line) => line.trim().split(/\s+/)[1]).find((value): value is string => Boolean(value && parseGitHubRepo(value)));
    const repo = remote ? parseGitHubRepo(remote) : undefined;
    if (!repo) throw new Error("current repository does not have a GitHub remote");
    const gitPathResult = await commands.run("git", ["rev-parse", "--git-path", "agent-controller"], { cwd: projectRoot, timeoutMs: 10_000 });
    if (gitPathResult.code !== 0) throw new Error("cannot resolve Git metadata directory");
    const stateRoot = resolve(projectRoot, gitPathResult.stdout.trim());
    const tasks = new GitHubIssueTracker(repo, policy, commands);
    this.projectRoot = projectRoot;
    this.policy = policy;
    return {
      projectRoot,
      policy,
      tasks,
      adapters: {
        tasks,
        workspaces: new GitWorkspaceManager(projectRoot, commands),
        agents: new PiProcessAgentRuntime(),
        verification: new LocalVerificationRunner(),
        journal: new FileJournal(resolve(stateRoot, "run-journal.jsonl")),
        lease: new FileRepositoryLease(resolve(stateRoot, "lease.json")),
      },
    };
  }
}

function makePreviewRun(projectRoot: string): Run {
  const now = Date.now();
  return { id: "dry-run", projectRoot, state: "STOPPED", phase: "DRY_RUN", usage: { completedTasks: 0, attempts: 0, tokens: 0, cost: 0, startedAt: now }, startedAt: now, updatedAt: now, stopReason: "BACKLOG_EMPTY" };
}

export function statusText(run: Run | undefined): string {
  if (!run) return "Controller: idle (no Run)";
  const task = run.currentTask === undefined ? "none" : `#${run.currentTask}`;
  const stop = run.stopReason ? ` stop=${run.stopReason}` : "";
  return `Controller: ${run.state.toLowerCase()} phase=${run.phase} task=${task} completed=${run.usage.completedTasks} attempts=${run.usage.attempts}${stop}`;
}

export function defaultConfigExample(): ControllerPolicy { return defaultPolicy(); }
