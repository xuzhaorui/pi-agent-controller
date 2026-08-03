import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ControllerService, statusText } from "./service.js";

export default function (pi: ExtensionAPI): void {
  const service = new ControllerService();

  const notifyResult = (ctx: ExtensionContext, result: any): void => {
    if (!result) return;
    const run = result.run ?? result;
    const actions = result.actions?.slice(-5).join(", ");
    ctx.ui.notify(`${statusText(run)}${actions ? ` actions=${actions}` : ""}`, run.stopReason && run.stopReason !== "BACKLOG_EMPTY" ? "warning" : "info");
    ctx.ui.setStatus("agent-controller", statusText(run));
  };

  pi.registerCommand("controller-start", {
    description: "Start the deterministic Agent Controller Run",
    handler: async (args, ctx) => {
      try {
        const result = await service.start(ctx, args.trim() === "--dry-run");
        notifyResult(ctx, result);
      } catch (error) {
        ctx.ui.notify(`Controller start failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.registerCommand("controller-status", {
    description: "Show Agent Controller Run status",
    handler: async (_args, ctx) => {
      const status = service.status();
      ctx.ui.notify(statusText(status), status?.stopReason && status.stopReason !== "BACKLOG_EMPTY" ? "warning" : "info");
    },
  });

  pi.registerCommand("controller-events", {
    description: "Show recent observable Execution events (default 10, maximum 20)",
    handler: async (args, ctx) => {
      const requested = Number(args.trim() || 10);
      const events = await service.executionEvents(Number.isFinite(requested) ? requested : 10, ctx);
      ctx.ui.notify(formatExecutionEvents(events), "info");
    },
  });

  pi.registerCommand("controller-pause", {
    description: "Pause the Agent Controller after the current safe checkpoint",
    handler: async (_args, ctx) => { await service.pause(); ctx.ui.notify("Controller pause requested", "info"); },
  });

  pi.registerCommand("controller-interrupt", {
    description: "Cancel only the active Execution; retry/block behavior remains Policy-controlled",
    handler: async (_args, ctx) => {
      const interrupted = service.interruptExecution();
      ctx.ui.notify(interrupted ? "Active Execution cancellation requested" : "No cancellable Execution is active", interrupted ? "warning" : "info");
    },
  });

  pi.registerCommand("controller-stop", {
    description: "Stop the Agent Controller and cancel the active Execution",
    handler: async (_args, ctx) => { await service.stop(); ctx.ui.notify("Controller stop requested", "warning"); },
  });

  pi.registerCommand("controller-resume", {
    description: "Resume the Agent Controller",
    handler: async (_args, ctx) => {
      try { notifyResult(ctx, await service.resume(ctx)); }
      catch (error) { ctx.ui.notify(`Controller resume failed: ${error instanceof Error ? error.message : String(error)}`, "error"); }
    },
  });

  pi.registerCommand("controller-approve", {
    description: "Resolve a pending Controller Human Gate: /controller-approve <gate-id> <decision>",
    handler: async (args, ctx) => {
      const [gateId, decision = "allow"] = args.trim().split(/\s+/);
      if (!gateId) { ctx.ui.notify("Usage: /controller-approve <gate-id> <decision>", "error"); return; }
      const result = await service.approve(gateId, decision, ctx);
      if (!result) { ctx.ui.notify("No matching pending Human Gate", "error"); return; }
      notifyResult(ctx, result);
    },
  });

  pi.registerTool({
    name: "controller_status",
    label: "Controller Status",
    description: "Read the current deterministic Pi Agent Controller Run status.",
    parameters: Type.Object({}),
    async execute() {
      const run = service.status();
      return { content: [{ type: "text", text: statusText(run) }], details: run ?? { state: "idle" } };
    },
  });

  pi.registerTool({
    name: "controller_execution_events",
    label: "Controller Execution Events",
    description: "Read recent normalized lifecycle, tool, usage, and termination events from Controller Executions.",
    parameters: Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })) }),
    async execute(_toolCallId: string, params: { limit?: number }, _signal: AbortSignal, _onUpdate: unknown, ctx: ExtensionContext) {
      const events = await service.executionEvents(params.limit ?? 10, ctx);
      return { content: [{ type: "text", text: formatExecutionEvents(events) }], details: { events } };
    },
  });

  pi.registerTool({
    name: "controller_start",
    label: "Controller Start",
    description: "Start or dry-run the deterministic GitHub-to-Pi Agent Controller workflow. Use dryRun before autonomous execution when requested.",
    parameters: Type.Object({ dryRun: Type.Optional(Type.Boolean()) }),
    async execute(_toolCallId: string, params: { dryRun?: boolean }, _signal: AbortSignal, _onUpdate: unknown, ctx: ExtensionContext) {
      const result = await service.start(ctx, params.dryRun === true);
      notifyResult(ctx, result);
      const run = result && "run" in result ? result.run : result;
      return { content: [{ type: "text", text: statusText(run) }], details: result ?? {} };
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("agent-controller", statusText(service.status()));
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    await service.shutdown();
    ctx.ui.setStatus("agent-controller", undefined);
  });
}

function formatExecutionEvents(events: Array<{ at: number; reason?: string; data?: Record<string, unknown> }>): string {
  if (events.length === 0) return "No Execution events recorded";
  return events.map((entry) => {
    const event = entry.data?.event as { role?: string; type?: string; summary?: string } | undefined;
    const timestamp = new Date(entry.at).toISOString();
    return `${timestamp} ${event?.role ?? "execution"}/${event?.type ?? "event"}: ${event?.summary ?? entry.reason ?? ""}`;
  }).join("\n");
}
