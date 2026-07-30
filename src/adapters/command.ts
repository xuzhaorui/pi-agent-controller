import { spawn } from "node:child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
  killed: boolean;
}

export interface CommandRunner {
  run(command: string, args: string[], options?: { cwd?: string; timeoutMs?: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv }): Promise<CommandResult>;
}

export class LocalCommandRunner implements CommandRunner {
  async run(command: string, args: string[], options: { cwd?: string; timeoutMs?: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {}): Promise<CommandResult> {
    const child = spawn(command, args, { cwd: options.cwd, shell: false, env: { ...process.env, ...options.env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killed = false;
    let timer: NodeJS.Timeout | undefined;
    const kill = () => {
      if (child.killed) return;
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 5_000).unref();
    };
    if (options.timeoutMs !== undefined) timer = setTimeout(kill, options.timeoutMs);
    if (options.signal) {
      if (options.signal.aborted) kill();
      else options.signal.addEventListener("abort", kill, { once: true });
    }
    child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    if (timer) clearTimeout(timer);
    return { stdout, stderr, code, killed };
  }
}
