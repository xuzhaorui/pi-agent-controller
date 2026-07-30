import type { ControllerPolicy, Task, TaskTracker } from "../domain.js";
import { taskFromIssue } from "../domain.js";
import { type CommandRunner, LocalCommandRunner } from "./command.js";

interface GitHubIssueJson {
  number: number;
  title: string;
  body: string | null;
  url: string;
  labels: Array<{ name: string }>;
}

export class GitHubIssueTracker implements TaskTracker {
  constructor(
    private readonly repo: string,
    private readonly policy: ControllerPolicy,
    private readonly commands: CommandRunner = new LocalCommandRunner(),
    private readonly secrets: string[] = policy.secrets ?? [],
  ) {}

  async listOpenTasks(): Promise<Task[]> {
    const result = await this.commands.run("gh", ["api", "--paginate", `repos/${this.repo}/issues?state=open&per_page=100`, "--jq", ".[] | @json"], { timeoutMs: 30_000 });
    if (result.code !== 0) throw new Error(`GitHub issue discovery failed: ${result.stderr.trim() || result.stdout.trim()}`);
    const issues: GitHubIssueJson[] = [];
    try {
      for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
        const encoded = JSON.parse(line) as string;
        const issue = JSON.parse(encoded) as GitHubIssueJson & { pull_request?: unknown; html_url?: string };
        if (!issue.pull_request) issues.push({ ...issue, url: issue.url ?? issue.html_url ?? "" });
      }
    } catch { throw new Error("GitHub issue discovery returned malformed JSON"); }
    return issues.map((issue) => {
      const labels = issue.labels.map((label) => label.name);
      const task = taskFromIssue({ number: issue.number, title: issue.title, body: issue.body ?? "", url: issue.url, labels }, this.policy);
      if (labels.includes(this.policy.inProgressLabel)) task.state = "CLAIMED";
      if (labels.includes(this.policy.reviewLabel)) task.state = "REVIEWING";
      if (labels.includes(this.policy.blockedLabel)) task.state = "BLOCKED";
      return task;
    });
  }

  async claim(task: Task, runId: string, label: string, marker: string): Promise<void> {
    await this.commentOnce(task.number, marker, `Controller Run ${runId} claimed Task #${task.number}.\n\nMarker: ${marker}`);
    await this.updateLabels(task.number, [label], [this.policy.readinessLabel]);
  }

  async markReview(task: Task, runId: string, label: string, marker: string): Promise<void> {
    await this.commentOnce(task.number, marker, `Controller Run ${runId} started review for Task #${task.number}.\n\nMarker: ${marker}`);
    await this.updateLabels(task.number, [label], [this.policy.inProgressLabel]);
  }

  async complete(task: Task, runId: string, label: string, comment: string, marker: string): Promise<void> {
    // Publish the durable completion evidence before mutating labels or closing
    // the Issue. A failed comment lookup/post therefore cannot leave a silent
    // done-labelled Issue.
    await this.commentOnce(task.number, marker, `${comment}\n\nMarker: ${marker}`);
    await this.updateLabels(task.number, [label], [this.policy.readinessLabel, this.policy.inProgressLabel, this.policy.reviewLabel, this.policy.blockedLabel]);
    if (this.policy.closeIssueOnDone) {
      const result = await this.commands.run("gh", ["issue", "close", String(task.number), "--repo", this.repo], { timeoutMs: 30_000 });
      if (result.code !== 0 && !/already closed/i.test(result.stderr)) throw new Error(`failed to close GitHub Issue #${task.number}: ${result.stderr.trim()}`);
    }
  }

  async block(task: Task, runId: string, label: string, comment: string, marker: string): Promise<void> {
    await this.commentOnce(task.number, marker, `Controller Run ${runId} blocked Task #${task.number}.\n\n${comment}\n\nMarker: ${marker}`);
    await this.updateLabels(task.number, [label], [this.policy.inProgressLabel, this.policy.reviewLabel]);
  }

  private async updateLabels(number: number, add: string[], remove: string[]): Promise<void> {
    const args = ["issue", "edit", String(number), "--repo", this.repo];
    for (const label of add.filter(Boolean)) args.push("--add-label", label);
    for (const label of remove.filter(Boolean)) args.push("--remove-label", label);
    const result = await this.commands.run("gh", args, { timeoutMs: 30_000 });
    if (result.code !== 0) throw new Error(`failed to update labels for GitHub Issue #${number}: ${result.stderr.trim()}`);
  }

  private async commentOnce(number: number, marker: string, body: string): Promise<void> {
    const existing = await this.commands.run("gh", ["api", "--paginate", `repos/${this.repo}/issues/${number}/comments`, "--jq", ".[].body"], { timeoutMs: 30_000 });
    if (existing.code !== 0) throw new Error(`failed to inspect comments for GitHub Issue #${number}: ${existing.stderr.trim()}`);
    if (existing.stdout.includes(marker)) return;
    const result = await this.commands.run("gh", ["issue", "comment", String(number), "--repo", this.repo, "--body", redact(body, this.secrets)], { timeoutMs: 30_000 });
    if (result.code !== 0) throw new Error(`failed to comment on GitHub Issue #${number}: ${result.stderr.trim()}`);
  }
}

function redact(value: string, secrets: string[]): string {
  const common = value
    .replace(/(api[_-]?key|token|password|secret|authorization)\s*([:=])\s*([^\s,;]+)/gi, "$1$2[REDACTED]")
    .replace(/(bearer)\s+[a-z0-9._~+\/-]+=*/gi, "$1 [REDACTED]");
  return secrets.filter(Boolean).reduce((result, secret) => result.split(secret).join("[REDACTED]"), common);
}

export function parseGitHubRepo(remote: string): string | undefined {
  const ssh = remote.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (ssh?.[1]) return ssh[1];
  const https = remote.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  return https?.[1];
}
