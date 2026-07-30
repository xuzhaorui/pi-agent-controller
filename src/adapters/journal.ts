import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { JournalEvent, JournalStore } from "../domain.js";

export class FileJournal implements JournalStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<JournalEvent[]> {
    try {
      const content = await readFile(this.filePath, "utf8");
      return content.split(/\r?\n/).filter(Boolean).map((line, index) => {
        try {
          return JSON.parse(line) as JournalEvent;
        } catch {
          throw new Error(`invalid Run Journal JSON at line ${index + 1}`);
        }
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async append(event: JournalEvent): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}

export class MemoryJournal implements JournalStore {
  readonly events: JournalEvent[] = [];
  async read(): Promise<JournalEvent[]> { return [...this.events]; }
  async append(event: JournalEvent): Promise<void> { this.events.push(event); }
}
