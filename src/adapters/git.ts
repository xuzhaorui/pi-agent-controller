import { mkdir, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { ControllerPolicy, Task, Workspace, WorkspaceManager } from "../domain.js";
import { type CommandRunner, LocalCommandRunner } from "./command.js";

export class GitWorkspaceManager implements WorkspaceManager {
  constructor(private readonly projectRoot: string, private readonly commands: CommandRunner = new LocalCommandRunner()) {}

  async create(task: Task, policy: ControllerPolicy): Promise<Workspace> {
    const status = await this.commands.run("git", ["status", "--porcelain"], { cwd: this.projectRoot, timeoutMs: 10_000 });
    if (status.code !== 0) throw new Error(`cannot inspect repository: ${status.stderr.trim()}`);
    if (status.stdout.trim()) throw new Error("repository has uncommitted changes; refusing to create a Workspace");
    const branch = branchName(task, policy);
    const root = resolve(this.projectRoot, policy.workspaceRoot);
    const path = resolve(root, `task-${task.number}`);
    if (!isWithin(root, path)) throw new Error("Workspace path escapes configured workspaceRoot");
    await mkdir(root, { recursive: true });
    const result = await this.commands.run("git", ["worktree", "add", "-b", branch, path, policy.baseBranch], { cwd: this.projectRoot, timeoutMs: 60_000 });
    if (result.code !== 0) throw new Error(`failed to create Workspace: ${result.stderr.trim() || result.stdout.trim()}`);
    return { taskNumber: task.number, path, branch, baseBranch: policy.baseBranch };
  }

  async find(task: Task, policy: ControllerPolicy): Promise<Workspace | undefined> {
    const branch = branchName(task, policy);
    const result = await this.commands.run("git", ["worktree", "list", "--porcelain"], { cwd: this.projectRoot, timeoutMs: 10_000 });
    if (result.code !== 0) return undefined;
    const lines = result.stdout.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index] !== `branch refs/heads/${branch}`) continue;
      const block = lines.slice(Math.max(0, index - 2), index + 4);
      if (block.includes("prunable")) return undefined;
      const worktreeLine = lines.slice(0, index).reverse().find((line) => line.startsWith("worktree "));
      const path = worktreeLine?.slice("worktree ".length);
      if (!path) return undefined;
      try { await stat(path); } catch { return undefined; }
      return { taskNumber: task.number, path, branch, baseBranch: policy.baseBranch };
    }
    return undefined;
  }

  async validate(workspace: Workspace): Promise<boolean> {
    const result = await this.commands.run("git", ["worktree", "list", "--porcelain"], { cwd: this.projectRoot, timeoutMs: 10_000 });
    if (result.code !== 0) return false;
    const lines = result.stdout.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index] !== `worktree ${workspace.path}`) continue;
      const block = lines.slice(index, lines.findIndex((line, offset) => offset > index && line === "") >= 0 ? lines.findIndex((line, offset) => offset > index && line === "") : lines.length);
      if (block.includes("prunable")) return false;
      const branch = lines[index + 2];
      try { await stat(workspace.path); } catch { return false; }
      return branch === `branch refs/heads/${workspace.branch}`;
    }
    return false;
  }

  async commit(_task: Task, workspace: Workspace): Promise<string | undefined> {
    const status = await this.commands.run("git", ["status", "--porcelain"], { cwd: workspace.path, timeoutMs: 10_000 });
    if (status.code !== 0) throw new Error(`cannot inspect Worker Workspace: ${status.stderr.trim()}`);
    if (status.stdout.trim()) throw new Error("Worker left uncommitted changes in the Workspace");
    const diff = await this.commands.run("git", ["diff", "--quiet", `${workspace.baseBranch}...HEAD`], { cwd: workspace.path, timeoutMs: 30_000 });
    if (diff.code === 0) throw new Error("Worker produced no committed changes");
    if (diff.code !== 1) throw new Error(`cannot inspect committed Workspace diff: ${diff.stderr.trim()}`);
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
    const removed = await this.commands.run("git", ["worktree", "remove", workspace.path], { cwd: this.projectRoot, timeoutMs: 30_000 });
    if (removed.code !== 0) {
      const listed = await this.commands.run("git", ["worktree", "list", "--porcelain"], { cwd: this.projectRoot, timeoutMs: 10_000 });
      if (listed.stdout.split(/\r?\n/).includes(`worktree ${workspace.path}`)) {
        try { await stat(workspace.path); throw new Error(`failed to remove Workspace: ${removed.stderr.trim()}`); }
        catch (error) {
          if (error instanceof Error && error.message.startsWith("failed to remove Workspace")) throw error;
          const pruned = await this.commands.run("git", ["worktree", "prune"], { cwd: this.projectRoot, timeoutMs: 10_000 });
          if (pruned.code !== 0) throw new Error(`failed to prune stale Workspace: ${pruned.stderr.trim()}`);
        }
      }
    }
    if (success) {
      const deleted = await this.commands.run("git", ["branch", "-d", workspace.branch], { cwd: this.projectRoot, timeoutMs: 10_000 });
      if (deleted.code !== 0) {
        const branch = await this.commands.run("git", ["branch", "--list", workspace.branch], { cwd: this.projectRoot, timeoutMs: 10_000 });
        if (branch.stdout.trim()) throw new Error(`failed to remove Workspace branch: ${deleted.stderr.trim()}`);
      }
    }
  }
}

function branchName(task: Task, policy: ControllerPolicy): string {
  return `${policy.branchPrefix}${task.number}`.replace(/[^a-zA-Z0-9._/-]+/g, "-").replace(/\/{2,}/g, "/");
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}
