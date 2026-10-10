import type { ControlledProcess } from "./controlled-execution.js";
import { existsSync } from "node:fs";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { PlumsError, CAPABILITY_FAILED } from "@plumsjs/core";
import {
  validateContributionValue,
  type ContributionKind,
  type DesktopContribution,
} from "@plumsjs/sdk";

import type { InvocationContext, RuntimeBridge } from "./foundation-runtime.js";
export type { InvocationContext, RuntimeBridge } from "./foundation-runtime.js";
export class ExtensionRuntime {
  private child?: ChildProcess;
  private exit: Promise<unknown> = Promise.resolve();
  private send(message: unknown) {
    if (this.controlled) this.controlled.write(message);
    else this.child?.send(message as object);
  }
  receiveControlled(raw: unknown) {
    void this.receive(raw);
  }
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
  private failureDeliveryMs = 0;
  private failureDeliverySince: number | undefined;
  private failureDeliveryTime(): number {
    return (
      this.failureDeliveryMs +
      (this.failureDeliverySince === undefined
        ? 0
        : performance.now() - this.failureDeliverySince)
    );
  }
  private pauseFailureDelivery(): void {
    this.failureDeliveryMs = this.failureDeliveryTime();
    this.failureDeliverySince = undefined;
  }
  private resumeFailureDelivery(): void {
    if (
      this.failures.size > 0 &&
      this.inflight === 0 &&
      this.failureDeliverySince === undefined
    )
      this.failureDeliverySince = performance.now();
  }
  private clearFailureDelivery(): void {
    this.failures.clear();
    this.failureDeliveryMs = 0;
    this.failureDeliverySince = undefined;
  }
  readonly controller = new AbortController();
  constructor(
    readonly id: string,
    private declaration: DesktopContribution,
    private bridge: RuntimeBridge,
    files: Record<string, string>,
    nodePath = process.execPath,
    private controlled?: ControlledProcess,
    private lifecycle?: () => void,
    private beforeInvoke?: (
      kind: ContributionKind,
      name: string,
      input: unknown,
      context: InvocationContext,
    ) => Promise<(() => Promise<void>) | undefined>,
    readonly instanceId: string = randomUUID(),
    private validateContributions = true,
    trackProcess?: (child: ChildProcess) => void,
  ) {
    const sibling = fileURLToPath(new URL("./worker.js", import.meta.url));
    const workerFile = existsSync(sibling)
      ? sibling
      : fileURLToPath(new URL("../dist/worker.js", import.meta.url));
    let trackingError: unknown;
    if (!controlled) {
      this.child = fork(workerFile, [], {
        execPath: nodePath,
        execArgv: ["--no-node-snapshot"],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: {},
      });
      try {
        trackProcess?.(this.child);
      } catch (error) {
        trackingError = error;
      }
      this.child.on("message", (raw) => {
        void this.receive(raw);
      });
      this.child.on("error", () => this.stop());
      this.exit = new Promise((r) => this.child!.once("close", r));
      this.child.on("exit", () => this.stop());
    } else {
      this.exit = controlled.done.then(() => controlled.cleaned);
      void controlled.done.then(() => this.stop());
    }
    this.watchdog = setInterval(() => {
      try {
        // A pending host RPC retains its own authorization and execution outcome.
        // After failure delivery, defer idle checks for five cumulative seconds
        // outside host RPC waits. This handoff allowance does not change the
        // isolate execution budget; repeated failures cannot renew it.
        if (
          this.inflight === 0 &&
          (this.failures.size === 0 || this.failureDeliveryTime() >= 5000)
        )
          this.lifecycle?.();
      } catch {
        this.stop();
      }
      if (this.controlled?.rss && this.controlled.rss > 256 * 1024 * 1024)
        this.stop();
      if (Date.now() - this.lastHeartbeat > 12_000) this.stop();
    }, 1000);
    this.watchdog.unref();
    const startup = trackingError
      ? Promise.reject(trackingError)
      : this.run(
          "start",
          { type: "start", entry: declaration.runtime, files },
          { callers: [], ancestry: [id], signal: this.controller.signal },
        );
    this.queue = startup;
    void startup.catch(() => this.stop());
  }
  get controlledMode(): boolean {
    return !!this.declaration.common;
  }
  get alive(): boolean {
    return !this.stopped;
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
    const copied = structuredClone(input);
    const declaration = this.declaration.contributes![kind]!.find(
      (c) => c.name === name,
    )!;
    const task = this.queue.then(async () => {
      await context.assertActive?.();
      if (
        this.declaration.sdkVersion === "2" &&
        this.validateContributions &&
        declaration.inputSchema !== undefined
      )
        validateContributionValue(declaration.inputSchema, copied, "input");
      const gate = await this.beforeInvoke?.(kind, name, copied, context);
      const original = context;
      const gated = gate
        ? {
            ...context,
            assertActive: async () => {
              await original.assertActive?.();
              await gate();
            },
          }
        : context;
      await gated.assertActive?.();
      const result = await this.run(
        randomUUID(),
        { type: "invoke", kind, name, input: copied },
        gated,
      );
      if (
        this.declaration.sdkVersion === "2" &&
        this.validateContributions &&
        declaration.outputSchema !== undefined
      )
        validateContributionValue(declaration.outputSchema, result, "output");
      return result;
    });
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
        context: {
          ...context,
          resourceInstanceId: this.instanceId,
          invocationId: id,
          signal: controller.signal,
        },
        cleanup,
      };
      this.clearFailureDelivery();
      context.onDispatch?.();
      this.send({ ...message, id });
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
      if (!this.controlled && (m.rss ?? 0) > 256 * 1024 * 1024) {
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
          ) ??
            new PlumsError({
              code: CAPABILITY_FAILED,
              message: "组件调用失败。",
              details: {
                reason: "PROVIDER_FAILED",
                executionState: "completed",
              },
            }),
        );
      this.clearFailureDelivery();
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
          ([
            "capability",
            "invoke",
            "protocol.invoke",
            "mcpCheck",
            "failResponse",
          ].includes(m.method) ||
            m.method.startsWith("common.") ||
            m.method.startsWith("resource.") ||
            m.method.startsWith("engine."))
        )
          throw Error();
        if (this.inflight === 0) this.pauseFailureDelivery();
        this.inflight++;
        let value: unknown;
        try {
          value = await this.bridge(m.method, m.args, pending.context);
        } finally {
          this.inflight--;
          this.resumeFailureDelivery();
        }
        if (!this.stopped && !pending.context.signal.aborted)
          this.send({
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
          this.resumeFailureDelivery();
          this.send({
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
  async close(): Promise<void> {
    this.stop();
    await this.exit;
  }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.controller.abort();
    clearInterval(this.watchdog);
    if (this.controlled) void this.controlled.stop();
    else if (this.child?.connected) this.child.send({ type: "stop" }, () => {});
    const timer = setTimeout(() => this.child?.kill("SIGKILL"), 500);
    timer.unref();
    this.pending?.reject(new Error("Extension stopped"));
    this.pending?.cleanup();
    this.pending = undefined;
  }
}
