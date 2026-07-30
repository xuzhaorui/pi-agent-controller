import { open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import type { RepositoryLease } from "../domain.js";

interface LeaseRecord { pid: number; runId: string; at: number; }

export class FileRepositoryLease implements RepositoryLease {
  private owner?: string;
  constructor(private readonly filePath: string, private readonly pid = process.pid) {}

  async acquire(runId: string): Promise<boolean> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const handle = await open(this.filePath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: this.pid, runId, at: Date.now() } satisfies LeaseRecord));
      await handle.close();
      this.owner = runId;
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const record = await this.readRecord();
      if (record?.runId === runId && record.pid === this.pid) {
        this.owner = runId;
        return true;
      }
      if (record && isAlive(record.pid)) return false;
      try { await unlink(this.filePath); } catch { return false; }
      return this.acquire(runId);
    }
  }

  async release(runId: string): Promise<void> {
    if (this.owner !== runId) return;
    const record = await this.readRecord();
    if (record?.runId === runId && record.pid === this.pid) {
      try { await unlink(this.filePath); } catch { /* another recovery process may have removed it */ }
    }
    this.owner = undefined;
  }

  private async readRecord(): Promise<LeaseRecord | undefined> {
    try { return JSON.parse(await readFile(this.filePath, "utf8")) as LeaseRecord; }
    catch { return undefined; }
  }
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
