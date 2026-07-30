import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defaultPolicy, type ControllerPolicy } from "./domain.js";

export async function loadPolicy(projectRoot: string): Promise<ControllerPolicy> {
  const fallback = defaultPolicy();
  const path = resolve(projectRoot, ".pi", "agent-controller.json");
  let raw: unknown;
  try { raw = JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new Error(`cannot read Controller Policy: ${(error as Error).message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Controller Policy must be a JSON object");
  const input = raw as Partial<ControllerPolicy>;
  return {
    ...fallback,
    ...input,
    priorityLabels: { ...fallback.priorityLabels, ...(input.priorityLabels ?? {}) },
    roles: {
      ...fallback.roles,
      ...(input.roles ?? {}),
      worker: { ...fallback.roles.worker, ...(input.roles?.worker ?? {}) },
      reviewer: { ...fallback.roles.reviewer, ...(input.roles?.reviewer ?? {}) },
      architect: { ...fallback.roles.architect, ...(input.roles?.architect ?? {}) },
    },
    verification: input.verification ?? fallback.verification,
    protectedBranches: input.protectedBranches ?? fallback.protectedBranches,
    guardedPathPatterns: input.guardedPathPatterns ?? fallback.guardedPathPatterns,
  };
}
