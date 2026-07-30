import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Evidence, VerificationCommand, VerificationRunner, Workspace } from "../domain.js";
import { type CommandRunner, LocalCommandRunner } from "./command.js";

const MAX_BYTES = 50 * 1024;
const MAX_LINES = 2_000;

export class LocalVerificationRunner implements VerificationRunner {
  constructor(
    private readonly artifactRoot = join(process.env.XDG_STATE_HOME ?? join(process.env.HOME ?? "/tmp", ".local", "state"), "pi-agent-controller", "artifacts"),
    private readonly commands: CommandRunner = new LocalCommandRunner(),
    private readonly secrets: string[] = [],
  ) {}

  async run(workspace: Workspace, commands: VerificationCommand[], signal: AbortSignal): Promise<Evidence[]> {
    const evidence: Evidence[] = [];
    for (const command of commands) {
      const started = Date.now();
      const result = await this.commands.run(command.command, command.args ?? [], { cwd: workspace.path, timeoutMs: command.timeoutMs ?? 10 * 60 * 1000, signal });
      if (signal.aborted) throw new Error("Verification was cancelled");
      const fullOutput = redact(`${result.stdout}\n${result.stderr}`.trim(), this.secrets);
      const artifactDir = join(this.artifactRoot, `task-${workspace.taskNumber}`);
      await mkdir(artifactDir, { recursive: true });
      const artifactPath = join(artifactDir, `${safeName(command.name)}-${started}.log`);
      await writeFile(artifactPath, fullOutput, { encoding: "utf8", mode: 0o600 });
      let output = truncate(fullOutput);
      if (output !== fullOutput) output += `\n\n[Output truncated; full output: ${artifactPath}]`;
      let success = result.code === 0 && !result.killed;
      const metadata: Record<string, string | number | boolean> = { command: command.command, killed: result.killed };
      if (command.metricFile && command.thresholds) {
        const metricPath = join(workspace.path, command.metricFile);
        try {
          const metrics = JSON.parse(await readFile(metricPath, "utf8")) as Record<string, unknown>;
          for (const [name, threshold] of Object.entries(command.thresholds)) {
            const value = metrics[name];
            if (typeof value !== "number") { success = false; metadata[`metric.${name}`] = "missing"; continue; }
            metadata[`metric.${name}`] = value;
            if (threshold.min !== undefined && value < threshold.min) success = false;
            if (threshold.max !== undefined && value > threshold.max) success = false;
          }
        } catch {
          success = false;
          metadata.metrics = "unreadable";
        }
      }
      evidence.push({
        id: `verification-${workspace.taskNumber}-${safeName(command.name)}-${started}`,
        kind: "verification",
        name: command.name,
        success,
        ...(result.code !== null ? { exitCode: result.code } : {}),
        durationMs: Date.now() - started,
        output,
        artifactPath,
        metadata,
      });
    }
    return evidence;
  }
}

function safeName(value: string): string { return value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "command"; }

function redact(value: string, secrets: string[]): string {
  return secrets.filter(Boolean).reduce((result, secret) => result.split(secret).join("[REDACTED]"), value);
}

function truncate(value: string): string {
  const lines = value.split(/\r?\n/);
  const limited = lines.slice(0, MAX_LINES).join("\n");
  let bytes = Buffer.byteLength(limited, "utf8");
  if (bytes <= MAX_BYTES && lines.length <= MAX_LINES) return value;
  let result = limited;
  while (bytes > MAX_BYTES) {
    result = result.slice(0, Math.max(0, result.length - Math.ceil((bytes - MAX_BYTES) / 2)));
    bytes = Buffer.byteLength(result, "utf8");
  }
  return result;
}
