import { mkdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { ControllerPolicy, Task, Workspace, WorkspaceManager } from "../domain.js";
import { type CommandRunner, LocalCommandRunner } from "./command.js";

export class GitWorkspaceManager implements WorkspaceManager {
  constructor(private readonly projectRoot: string, private readonly commands: CommandRunner = new LocalCommandRunner()) {}

  async create(task: Task, policy: ControllerPolicy): Promise<Workspace> {
    const status = await this.commands.run("git", ["status", "--porcelain"], { cwd: this.projectRoot, timeoutMs: 10_000 });
    if (status.code !== 0) throw new Error(`cannot inspect repository: ${status.stderr.trim()}`);
    if (status.stdout.trim()) throw new Error("repository has uncommitted changes; refusing to create a Workspace");
    const branch = `${policy.branchPrefix}${task.number}`.replace(/[^a-zA-Z0-9._/-]+/g, "-").replace(/\/{2,}/g, "/");
    const root = resolve(this.projectRoot, policy.workspaceRoot);
    const path = resolve(root, `task-${task.number}`);
    if (!isWithin(root, path)) throw new Error("Workspace path escapes configured workspaceRoot");
    await mkdir(root, { recursive: true });
    const result = await this.commands.run("git", ["worktree", "add", "-b", branch, path, policy.baseBranch], { cwd: this.projectRoot, timeoutMs: 60_000 });
    if (result.code !== 0) throw new Error(`failed to create Workspace: ${result.stderr.trim() || result.stdout.trim()}`);
    return { taskNumber: task.number, path, branch, baseBranch: policy.baseBranch };
  }

  async commit(_task: Task, workspace: Workspace): Promise<string | undefined> {
    const result = await this.commands.run("git", ["log", "-1", "--format=%H"], { cwd: workspace.path, timeoutMs: 10_000 });
    return result.code === 0 ? result.stdout.trim() || undefined : undefined;
  }

  async diff(workspace: Workspace): Promise<string> {
    const result = await this.commands.run("git", ["diff", `${workspace.baseBranch}...HEAD`], { cwd: workspace.path, timeoutMs: 30_000 });
    if (result.code !== 0) throw new Error(`failed to read Workspace diff: ${result.stderr.trim()}`);
    return result.stdout;
  }

  async merge(workspace: Workspace, _policy: ControllerPolicy): Promise<{ commit?: string }> {
    const result = await this.commands.run("git", ["merge", "--no-ff", workspace.branch, "-m", `Merge ${workspace.branch}`], { cwd: this.projectRoot, timeoutMs: 60_000 });
    if (result.code !== 0) {
      await this.commands.run("git", ["merge", "--abort"], { cwd: this.projectRoot, timeoutMs: 10_000 });
      throw new Error(`merge conflict or failure: ${result.stderr.trim() || result.stdout.trim()}`);
    }
    const head = await this.commands.run("git", ["rev-parse", "HEAD"], { cwd: this.projectRoot, timeoutMs: 10_000 });
    return { commit: head.code === 0 ? head.stdout.trim() || undefined : undefined };
  }

  async cleanup(workspace: Workspace, policy: ControllerPolicy, success: boolean): Promise<void> {
    if ((success && !policy.cleanupOnSuccess) || (!success && !policy.cleanupOnFailure)) return;
    await this.commands.run("git", ["worktree", "remove", workspace.path], { cwd: this.projectRoot, timeoutMs: 30_000 });
    if (success) await this.commands.run("git", ["branch", "-d", workspace.branch], { cwd: this.projectRoot, timeoutMs: 10_000 });
  }
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}
