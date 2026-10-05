import { existsSync } from "node:fs";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { PlumsError } from "@plums/core";
import type { CapabilityCaller } from "@plums/core";
import type { ContributionKind, DesktopContribution } from "@plums/sdk";

export interface InvocationContext {
  callers: CapabilityCaller[];
  ancestry: string[];
  signal: AbortSignal;
}
export type RuntimeBridge = (
  method: string,
  args: Record<string, unknown>,
  context: InvocationContext,
) => Promise<unknown>;
export class ExtensionRuntime {
  private child: ChildProcess;
  private pending:
    | {
        id: string;
        resolve: (v: unknown) => void;
        reject: (e: Error) => void;
        context: InvocationContext;
        cleanup: () => void;
      }
    | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private lastHeartbeat = Date.now();
  private watchdog: ReturnType<typeof setInterval>;
  private stopped = false;
  private failures = new Map<string, Error>();
  private inflight = 0;
  readonly controller = new AbortController();
  constructor(
    readonly id: string,
    private declaration: DesktopContribution,
    private bridge: RuntimeBridge,
    files: Record<string, string>,
    nodePath = process.execPath,
  ) {
    const sibling = fileURLToPath(new URL("./worker.js", import.meta.url));
    const workerFile = existsSync(sibling)
      ? sibling
      : fileURLToPath(new URL("../dist/worker.js", import.meta.url));
    this.child = fork(workerFile, [], {
      execPath: nodePath,
      execArgv: ["--no-node-snapshot"],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: {},
    });
    this.child.on("message", (raw) => {
      void this.receive(raw);
    });
    this.child.on("error", () => this.stop());
    this.child.on("exit", () => this.stop());
    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastHeartbeat > 12_000) this.stop();
    }, 1000);
    this.watchdog.unref();
    const startup = this.run(
      "start",
      { type: "start", entry: declaration.runtime, files },
      { callers: [], ancestry: [id], signal: this.controller.signal },
    );
    this.queue = startup;
    void startup.catch(() => this.stop());
  }
  async ready(): Promise<void> {
    await this.queue;
  }
  invoke(
    kind: ContributionKind,
    name: string,
    input: unknown,
    context: InvocationContext,
  ): Promise<unknown> {
    if (!this.declaration.contributes?.[kind]?.some((c) => c.name === name))
      return Promise.reject(new Error("Contribution not declared"));
    const task = this.queue.then(() =>
      this.run(randomUUID(), { type: "invoke", kind, name, input }, context),
    );
    this.queue = task.catch(() => undefined);
    return task;
  }
  deliverEvent(
    topic: string,
    event: unknown,
    context: InvocationContext,
  ): Promise<unknown> {
    const task = this.queue.then(() =>
      this.run(randomUUID(), { type: "event", topic, event }, context),
    );
    this.queue = task.catch(() => undefined);
    return task;
  }
  private run(
    id: string,
    message: object,
    context: InvocationContext,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.stopped || context.signal.aborted) {
        reject(new Error("Extension stopped"));
        return;
      }
      const controller = new AbortController();
      const cancel = () => {
        controller.abort();
        this.stop();
      };
      context.signal.addEventListener("abort", cancel, { once: true });
      this.controller.signal.addEventListener("abort", cancel, { once: true });
      const cleanup = () => {
        context.signal.removeEventListener("abort", cancel);
        this.controller.signal.removeEventListener("abort", cancel);
        controller.abort();
      };
      this.pending = {
        id,
        resolve,
        reject,
        context: { ...context, signal: controller.signal },
        cleanup,
      };
      this.failures.clear();
      this.child.send({ ...message, id });
    });
  }
  private async receive(raw: unknown): Promise<void> {
    if (this.stopped) return;
    const m = raw as {
      type: string;
      id: string;
      method: string;
      args: Record<string, unknown>;
      ok: boolean;
      value: unknown;
      rss?: number;
    };
    if (m.type === "heartbeat") {
      if ((m.rss ?? 0) > 256 * 1024 * 1024) {
        this.stop();
        return;
      }
      this.lastHeartbeat = Date.now();
      return;
    }
    if (m.type === "fatal") {
      this.stop();
      return;
    }
    const pending = this.pending;
    if (m.type === "result" && pending?.id === m.id) {
      this.pending = undefined;
      pending.cleanup();
      if (m.ok) pending.resolve(m.value);
      else
        pending.reject(
          this.failures.get(
            (m.value as { failureId?: string })?.failureId ?? "",
          ) ?? new Error("Extension handler failed"),
        );
    } else if (m.type === "rpc") {
      try {
        if (
          !pending ||
          pending.context.signal.aborted ||
          this.inflight >= 32 ||
          Buffer.byteLength(JSON.stringify(m)) > 1024 * 1024
        )
          throw Error();
        // Activation registers interfaces; I/O and delegated work require an invocation context.
        if (
          pending.id === "start" &&
          ["capability", "invoke", "mcpCheck"].includes(m.method)
        )
          throw Error();
        this.inflight++;
        let value: unknown;
        try {
          value = await this.bridge(m.method, m.args, pending.context);
        } finally {
          this.inflight--;
        }
        if (!this.stopped && !pending.context.signal.aborted)
          this.child.send({
            type: "reply",
            id: m.id,
            ok: true,
            value: value ?? null,
          });
      } catch (error) {
        if (!this.stopped) {
          const failureId = randomUUID();
          this.failures.set(
            failureId,
            error instanceof PlumsError
              ? error
              : new Error("Host request failed"),
          );
          this.child.send({
            type: "reply",
            id: m.id,
            ok: false,
            value:
              error instanceof PlumsError
                ? {
                    failureId,
                    code: error.code,
                    message: error.message,
                    path: error.path,
                    details: error.details,
                  }
                : {
                    failureId,
                    code: "HOST_FAILED",
                    message: "Host request failed",
                  },
          });
        }
      }
    }
  }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.controller.abort();
    clearInterval(this.watchdog);
    if (this.child.connected) this.child.send({ type: "stop" }, () => {});
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 500);
    timer.unref();
    this.pending?.reject(new Error("Extension stopped"));
    this.pending?.cleanup();
    this.pending = undefined;
  }
}
