import { existsSync } from "node:fs";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PlumsError, CAPABILITY_FAILED, PERMISSION_DENIED } from "@plums/core";
import type { EngineStatus } from "@plums/sdk";
const MAX_MESSAGE = 1024 * 1024;
function failed(
  callId: string,
  reason: string,
  executionState = "unknown",
): PlumsError {
  return new PlumsError({
    code: CAPABILITY_FAILED,
    message: "Engine operation did not complete.",
    details: { callId, phase: "engine", reason, executionState },
  });
}
interface Pending {
  bytes: number;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer?: NodeJS.Timeout;
  hooks?: EngineHooks;
  requestId?: string;
  controller: AbortController;
  dispose(): void;
}
interface Run {
  state: EngineStatus["state"];
  controller: AbortController;
  start: Promise<void>;
  child?: ChildProcess;
  buffer: Buffer;
  pending: Map<string, Pending>;
  callbacks: Map<string, { bytes: number; controller: AbortController }>;
  done: Promise<void>;
  finish: () => void;
  stop?: Promise<void>;
}
export interface EngineHooks {
  trackProcess?: (child: ChildProcess) => void;
  prepare(signal: AbortSignal): Promise<{
    entry: string;
    cwd: string;
    context?: import("@plums/sdk").EngineRuntimeContext;
  }>;
  active(): Promise<void>;
  /** Final synchronous check after async authorization and immediately before dispatch. */
  assertCurrent?(): void;
  /** Trusted request lifetime; never supplied in engine JSONL parameters. */
  signal?: AbortSignal;
  /** Legacy unbound callbacks are only safe for an owner's direct request. */
  allowUnboundCallback?: boolean;
  /** Callbacks cannot select a broader simultaneous request's authority. */
  callbackScope?: string;
  callback(
    method: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown>;
  event(topic: string, data: unknown): void;
  cleanup?(): Promise<void>;
  audit(action: "start" | "stop" | "crash"): Promise<void>;
}
/** Independent from component isolates and frontend lifetime. One supervisor per running identity. */
export class EngineManager {
  private runs = new Map<string, Run>();
  constructor(private readonly nodePath = process.execPath) {}
  state(key: string): EngineStatus["state"] {
    return this.runs.get(key)?.state ?? "stopped";
  }
  async start(key: string, hooks: EngineHooks): Promise<void> {
    const old = this.runs.get(key);
    if (old?.stop) {
      await old.stop.catch(() => {});
      if (this.runs.get(key) === old) this.runs.delete(key);
      return this.start(key, hooks);
    }
    if (old?.state === "running" || old?.state === "starting") {
      await old.start;
      await hooks.active();
      return;
    }
    const controller = new AbortController();
    let finish!: () => void;
    const run: Run = {
      state: "starting",
      controller,
      buffer: Buffer.alloc(0),
      pending: new Map(),
      callbacks: new Map(),
      start: Promise.resolve(),
      done: new Promise((r) => {
        finish = r;
      }),
      finish: () => finish(),
    };
    this.runs.set(key, run);
    run.start = (async () => {
      const prepared = await hooks.prepare(controller.signal);
      await hooks.active();
      if (controller.signal.aborted)
        throw failed(randomUUID(), "ENGINE_CANCELLED", "not_started");
      await hooks.audit("start");
      await hooks.active();
      if (controller.signal.aborted)
        throw failed(randomUUID(), "ENGINE_CANCELLED", "not_started");
      const env = { ...process.env };
      delete env.NODE_OPTIONS;
      delete env.NODE_PATH;
      delete env.ELECTRON_RUN_AS_NODE;
      const sibling = fileURLToPath(
        new URL("./engine-supervisor.js", import.meta.url),
      );
      const supervisor = existsSync(sibling)
        ? sibling
        : fileURLToPath(
            new URL("../dist/engine-supervisor.js", import.meta.url),
          );
      run.child = fork(supervisor, [], {
        execPath: this.nodePath,
        env,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        execArgv: [],
      });
      run.child.on("message", (raw) => this.message(key, run, hooks, raw));
      run.child.on("error", () => {
        void this.terminate(key, run, hooks, true).catch(() => {});
      });
      run.child.on("exit", () => {
        const crash = run.state !== "stopping" && run.state !== "stopped";
        run.state = crash ? "crashed" : "stopped";
        run.controller.abort();
        for (const [id, p] of run.pending) {
          clearTimeout(p.timer);
          p.dispose();
          p.reject(failed(id, "ENGINE_EXITED"));
        }
        run.pending.clear();
        run.finish();
        if (crash && !run.stop) void hooks.audit("crash").catch(() => {});
        hooks.event("engine.status", { state: run.state });
      });
      hooks.trackProcess?.(run.child);
      run.child.send({ type: "start", ...prepared });
      const hello = (await this.send(
        run,
        "initialize",
        {
          protocol: "jsonrpc-jsonl-v1",
          ...(prepared.context ? { context: prepared.context } : {}),
        },
        undefined,
        30_000,
      )) as { protocol?: unknown };
      if (!hello || hello.protocol !== "jsonrpc-jsonl-v1")
        throw failed(randomUUID(), "ENGINE_HANDSHAKE_FAILED", "not_started");
      await hooks.active();
      if (controller.signal.aborted)
        throw failed(randomUUID(), "ENGINE_CANCELLED", "not_started");
      run.state = "running";
      hooks.event("engine.status", { state: run.state });
    })().catch(async (error) => {
      if (run.child) await this.terminate(key, run, hooks, true);
      else {
        run.state = "stopped";
        run.finish();
      }
      throw error instanceof PlumsError
        ? error
        : failed(
            randomUUID(),
            "ENGINE_START_FAILED",
            run.child ? "unknown" : "not_started",
          );
    });
    return run.start;
  }
  private write(run: Run, message: unknown): void {
    const data = JSON.stringify(message) + "\n";
    if (Buffer.byteLength(data) > MAX_MESSAGE + 1)
      throw failed(randomUUID(), "ENGINE_MESSAGE_LIMIT", "not_started");
    if (!run.child?.connected || run.controller.signal.aborted)
      throw failed(randomUUID(), "ENGINE_STOPPED", "not_started");
    run.child.send({ type: "write", data }, (error) => {
      if (error && run.child?.connected)
        run.child.send({ type: "stop" }, () => {});
    });
  }
  private send(
    run: Run,
    method: string,
    params: unknown,
    id: string = randomUUID(),
    timeout?: number,
    hooks?: EngineHooks,
    requestId?: string,
  ): Promise<unknown> {
    if (
      run.pending.size + run.callbacks.size >= 32 ||
      run.pending.has(id) ||
      (requestId !== undefined &&
        [...run.pending.values()].some((p) => p.requestId === requestId))
    )
      return Promise.reject(failed(id, "ENGINE_REQUEST_LIMIT", "not_started"));
    let bytes: number;
    try {
      bytes = Buffer.byteLength(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      );
    } catch {
      return Promise.reject(
        failed(id, "ENGINE_MESSAGE_INVALID", "not_started"),
      );
    }
    if (
      bytes > MAX_MESSAGE ||
      [...run.pending.values()].reduce((n, p) => n + p.bytes, 0) +
        [...run.callbacks.values()].reduce((n, c) => n + c.bytes, 0) +
        bytes >
        8 * MAX_MESSAGE
    )
      return Promise.reject(failed(id, "ENGINE_MESSAGE_LIMIT", "not_started"));
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const abort = () => this.cancelPending(run, hooks!, id);
      const p: Pending = {
        resolve,
        reject,
        bytes,
        hooks,
        requestId,
        controller,
        dispose: () => {
          hooks?.signal?.removeEventListener("abort", abort);
          controller.abort();
        },
      };
      run.pending.set(id, p);
      if (timeout)
        p.timer = setTimeout(() => {
          run.pending.delete(id);
          p.dispose();
          reject(failed(id, "ENGINE_HANDSHAKE_TIMEOUT", "not_started"));
        }, timeout);
      try {
        if (hooks?.signal?.aborted)
          throw failed(id, "ENGINE_AUTHORIZATION_CHANGED", "not_started");
        this.write(run, { jsonrpc: "2.0", id, method, params });
        hooks?.signal?.addEventListener("abort", abort, { once: true });
      } catch (error) {
        run.pending.delete(id);
        clearTimeout(p.timer);
        p.dispose();
        reject(error);
      }
    });
  }
  private message(
    key: string,
    run: Run,
    hooks: EngineHooks,
    raw: unknown,
  ): void {
    const m = raw as { type: string; data: string };
    if (m.type !== "stdout") return;
    if (run.controller.signal.aborted) return;
    const chunk = Buffer.from(m.data, "base64");
    if (run.buffer.length + chunk.length > 8 * MAX_MESSAGE) {
      void this.terminate(key, run, hooks, true).catch(() => {});
      return;
    }
    run.buffer = Buffer.concat([run.buffer, chunk]);
    let at: number;
    while ((at = run.buffer.indexOf(10)) >= 0) {
      const line = run.buffer.subarray(0, at);
      run.buffer = run.buffer.subarray(at + 1);
      if (line.length > MAX_MESSAGE) {
        void this.terminate(key, run, hooks, true).catch(() => {});
        return;
      }
      try {
        this.rpc(
          run,
          hooks,
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line)),
        );
      } catch {
        void this.terminate(key, run, hooks, true).catch(() => {});
        return;
      }
    }
    if (run.buffer.length > MAX_MESSAGE)
      void this.terminate(key, run, hooks, true).catch(() => {});
  }
  private rpc(run: Run, hooks: EngineHooks, m: Record<string, unknown>): void {
    if (!m || Array.isArray(m) || m.jsonrpc !== "2.0")
      throw Error("Invalid RPC");
    if (typeof m.method === "string") {
      if (m.id === undefined) {
        if (m.method === "$/cancelRequest") {
          const id = (m.params as { id?: unknown })?.id;
          if (typeof id !== "string") throw Error("Invalid cancellation");
          run.callbacks.get(id)?.controller.abort();
          return;
        }
        if (m.method !== "engine.event") throw Error("Invalid event");
        const p = m.params as { topic: string; data: unknown };
        if (
          !p ||
          typeof p.topic !== "string" ||
          !/^[a-zA-Z0-9_.-]{1,64}$/.test(p.topic)
        )
          throw Error("Invalid event");
        hooks.event("engine.event", p);
        return;
      }
      if (
        typeof m.id !== "string" ||
        m.id.length > 128 ||
        ![
          "host.invoke",
          "host.invokeProtocol",
          "host.protocolStatus",
          "host.confirm",
          "host.grant",
        ].includes(m.method) ||
        run.callbacks.has(m.id) ||
        run.callbacks.size + run.pending.size >= 32
      )
        throw Error("Invalid callback");
      const bytes = Buffer.byteLength(JSON.stringify(m));
      if (
        [...run.pending.values()].reduce((n, p) => n + p.bytes, 0) +
          [...run.callbacks.values()].reduce((n, c) => n + c.bytes, 0) +
          bytes >
        8 * MAX_MESSAGE
      )
        throw Error("Callback buffer limit");
      const callbackController = new AbortController();
      // The engine can identify a request, but only the host supplies its authority.
      // A missing/stale association must never fall back to an owner-only chain.
      const candidates = [...run.pending.values()].filter((p) => p.hooks);
      const parent =
        typeof m.parentRequestId === "string"
          ? run.pending.get(m.parentRequestId)
          : m.parentRequestId === undefined &&
              candidates.length === 1 &&
              candidates[0]!.hooks?.allowUnboundCallback !== false
            ? candidates[0]
            : undefined;
      run.callbacks.set(m.id, { bytes, controller: callbackController });
      void (async () => {
        let executionState: "not_started" | "unknown" | "completed" =
          "not_started";
        try {
          if (
            !parent?.hooks ||
            parent.controller.signal.aborted ||
            candidates.some(
              (p) => p.hooks!.callbackScope !== parent.hooks!.callbackScope,
            )
          )
            throw new PlumsError({
              code: PERMISSION_DENIED,
              message: "Host callback has no active request.",
            });
          const requestHooks = parent.hooks;
          const signal = AbortSignal.any([
            run.controller.signal,
            callbackController.signal,
            parent.controller.signal,
          ]);
          const active = async () => {
            if (signal.aborted)
              throw new PlumsError({
                code: PERMISSION_DENIED,
                message: "Host callback request ended.",
              });
            await requestHooks.active();
            requestHooks.assertCurrent?.();
            if (signal.aborted)
              throw new PlumsError({
                code: PERMISSION_DENIED,
                message: "Host callback request ended.",
              });
          };
          await active();
          executionState = "unknown";
          const result = await requestHooks.callback(
            m.method as string,
            m.params,
            signal,
          );
          executionState = "completed";
          await active();
          this.write(run, { jsonrpc: "2.0", id: m.id, result });
        } catch (error) {
          const code =
            error instanceof PlumsError &&
            [
              "PERMISSION_DENIED",
              "CONSENT_REQUIRED",
              "CONFIRMATION_DENIED",
              "CAPABILITY_FAILED",
              "SETTINGS_INVALID",
            ].includes(error.code)
              ? error.code
              : "CAPABILITY_FAILED";
          const described =
            error instanceof PlumsError &&
            error.details &&
            typeof error.details === "object"
              ? (error.details as { executionState?: unknown }).executionState
              : undefined;
          if (
            ["not_started", "unknown", "completed"].includes(
              described as string,
            )
          )
            executionState = described as typeof executionState;
          else if (
            executionState === "unknown" &&
            [
              "PERMISSION_DENIED",
              "CONSENT_REQUIRED",
              "CONFIRMATION_DENIED",
              "SETTINGS_INVALID",
            ].includes(code)
          )
            executionState = "not_started";
          try {
            this.write(run, {
              jsonrpc: "2.0",
              id: m.id,
              error: {
                code: -32000,
                message: "Host callback refused.",
                data: { code, executionState },
              },
            });
          } catch {}
        } finally {
          run.callbacks.delete(m.id as string);
        }
      })();
      return;
    }
    if (
      typeof m.id !== "string" ||
      Object.hasOwn(m, "result") === Object.hasOwn(m, "error")
    )
      throw Error("Invalid reply");
    const p = run.pending.get(m.id);
    if (!p) return; // A late cancelled response cannot replay a task.
    run.pending.delete(m.id);
    clearTimeout(p.timer);
    p.dispose();
    m.error === undefined
      ? p.resolve(m.result)
      : p.reject(failed(m.id, "ENGINE_TASK_FAILED", "completed"));
  }
  async request(
    key: string,
    hooks: EngineHooks,
    method: string,
    input: unknown,
    id?: string,
  ): Promise<unknown> {
    const run = this.runs.get(key);
    if (
      !run ||
      run.state !== "running" ||
      !/^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/.test(method) ||
      method === "initialize" ||
      method.startsWith("host.") ||
      (id !== undefined &&
        (typeof id !== "string" || !/^[a-zA-Z0-9_.-]{1,128}$/.test(id)))
    )
      throw new PlumsError({
        code: PERMISSION_DENIED,
        message: "Engine request refused.",
      });
    try {
      await hooks.active();
      hooks.assertCurrent?.();
    } catch {
      throw failed(
        id ?? randomUUID(),
        "ENGINE_AUTHORIZATION_CHANGED",
        "not_started",
      );
    }
    // Public cancellation labels can be reused. Wire identities cannot: a stale
    // callback must not attach to a later task bearing the same caller label.
    const result = await this.send(
      run,
      method,
      input,
      randomUUID(),
      undefined,
      hooks,
      id,
    );
    try {
      await hooks.active();
      hooks.assertCurrent?.();
    } catch {
      throw failed(
        id ?? randomUUID(),
        "ENGINE_AUTHORIZATION_CHANGED",
        "completed",
      );
    }
    return result;
  }
  async cancel(key: string, hooks: EngineHooks, id: string): Promise<void> {
    await hooks.active();
    const run = this.runs.get(key);
    if (!run) return;
    const pending = [...run.pending].find(
      ([wireId, p]) => wireId === id || p.requestId === id,
    );
    if (pending) this.cancelPending(run, hooks, pending[0]);
  }
  private cancelPending(run: Run, hooks: EngineHooks, id: string): void {
    const p = run.pending.get(id);
    if (!p || p.controller.signal.aborted) return;
    // Close every attached callback before telling the process to cancel.
    p.dispose();
    try {
      this.write(run, {
        jsonrpc: "2.0",
        method: "$/cancelRequest",
        params: { id },
      });
    } catch {}
    clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      if (run.pending.has(id))
        // Find the still-owned run; a cancelled old run cannot kill a restart.
        for (const [key, current] of this.runs)
          if (current === run)
            void this.terminate(key, run, hooks, true).catch(() => {});
    }, 5000);
  }
  private terminate(
    key: string,
    run: Run,
    hooks: EngineHooks,
    crash = false,
  ): Promise<void> {
    if (run.stop) return run.stop;
    run.state = crash ? "crashed" : "stopping";
    run.controller.abort();
    if (run.child?.connected) run.child.send({ type: "stop" });
    run.stop = (async () => {
      if (!run.child) {
        await run.start.catch(() => {});
        run.finish();
      }
      await run.done;
      run.state = crash ? "crashed" : "stopped";
      try {
        await hooks.audit(crash ? "crash" : "stop");
      } finally {
        hooks.event("engine.status", { state: run.state });
        if (!crash && this.runs.get(key) === run) this.runs.delete(key);
      }
    })();
    return run.stop;
  }
  async stop(key: string, hooks: EngineHooks): Promise<void> {
    const run = this.runs.get(key);
    if (run) await this.terminate(key, run, hooks);
  }
}
