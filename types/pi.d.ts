declare module "@earendil-works/pi-coding-agent" {
  export interface ExtensionContext {
    cwd: string;
    mode: "tui" | "rpc" | "json" | "print";
    hasUI: boolean;
    signal?: AbortSignal;
    ui: {
      notify(message: string, level: "info" | "warning" | "error"): void;
      setStatus(key: string, value: string | undefined): void;
      setWidget(key: string, value: string[] | undefined): void;
      confirm(title: string, message: string): Promise<boolean>;
      input(title: string, placeholder?: string): Promise<string | undefined>;
    };
  }

  export interface ExtensionCommandContext extends ExtensionContext {
    waitForIdle(): Promise<void>;
  }

  export interface ExtensionAPI {
    on(event: string, handler: (event: any, ctx: ExtensionContext) => any): void;
    registerCommand(name: string, options: {
      description?: string;
      handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
    }): void;
    registerTool(definition: any): void;
    exec(command: string, args: string[], options?: { cwd?: string; timeout?: number; signal?: AbortSignal }): Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
      killed?: boolean;
    }>;
    appendEntry(customType: string, data?: unknown): void;
    sendMessage(message: { customType: string; content: string; display?: boolean; details?: unknown }, options?: { triggerTurn?: boolean; deliverAs?: string }): void;
  }

  export function truncateHead(input: string, options: { maxLines: number; maxBytes: number }): {
    content: string;
    truncated: boolean;
    outputLines: number;
    totalLines: number;
    outputBytes: number;
    totalBytes: number;
  };
}

declare module "typebox" {
  export const Type: any;
}
