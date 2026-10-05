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
}
interface Run {
  state: EngineStatus["state"];
  controller: AbortController;
  start: Promise<void>;
  child?: ChildProcess;
  buffer: Buffer;
  pending: Map<string, Pending>;
  callbackCount: number;
  callbackIds: Map<string, number>;
  done: Promise<void>;
  finish: () => void;
  stop?: Promise<void>;
}
export interface EngineHooks {
  prepare(signal: AbortSignal): Promise<{ entry: string; cwd: string }>;
  active(): Promise<void>;
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
      callbackCount: 0,
      callbackIds: new Map(),
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
          p.reject(failed(id, "ENGINE_EXITED"));
        }
        run.pending.clear();
        run.finish();
        if (crash && !run.stop) void hooks.audit("crash").catch(() => {});
        hooks.event("engine.status", { state: run.state });
      });
      run.child.send({ type: "start", ...prepared });
      const hello = (await this.send(
        run,
        "initialize",
        { protocol: "jsonrpc-jsonl-v1" },
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
  ): Promise<unknown> {
    if (run.pending.size + run.callbackCount >= 32 || run.pending.has(id))
      return Promise.reject(failed(id, "ENGINE_REQUEST_LIMIT", "not_started"));
    const bytes = Buffer.byteLength(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    );
    if (
      bytes > MAX_MESSAGE ||
      [...run.pending.values()].reduce((n, p) => n + p.bytes, 0) +
        [...run.callbackIds.values()].reduce((n, b) => n + b, 0) +
        bytes >
        8 * MAX_MESSAGE
    )
      return Promise.reject(failed(id, "ENGINE_MESSAGE_LIMIT", "not_started"));
    return new Promise((resolve, reject) => {
      const p: Pending = { resolve, reject, bytes };
      run.pending.set(id, p);
      if (timeout)
        p.timer = setTimeout(() => {
          run.pending.delete(id);
          reject(failed(id, "ENGINE_HANDSHAKE_TIMEOUT", "not_started"));
        }, timeout);
      try {
        this.write(run, { jsonrpc: "2.0", id, method, params });
      } catch (error) {
        run.pending.delete(id);
        clearTimeout(p.timer);
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
        !["host.invoke", "host.confirm"].includes(m.method) ||
        run.callbackIds.has(m.id) ||
        ++run.callbackCount + run.pending.size > 32
      )
        throw Error("Invalid callback");
      const bytes = Buffer.byteLength(JSON.stringify(m));
      if (
        [...run.pending.values()].reduce((n, p) => n + p.bytes, 0) +
          [...run.callbackIds.values()].reduce((n, b) => n + b, 0) +
          bytes >
        8 * MAX_MESSAGE
      )
        throw Error("Callback buffer limit");
      run.callbackIds.set(m.id, bytes);
      void (async () => {
        try {
          await hooks.active();
          const result = await hooks.callback(
            m.method as string,
            m.params,
            run.controller.signal,
          );
          await hooks.active();
          this.write(run, { jsonrpc: "2.0", id: m.id, result });
        } catch {
          try {
            this.write(run, {
              jsonrpc: "2.0",
              id: m.id,
              error: { code: -32000, message: "Host callback refused." },
            });
          } catch {}
        } finally {
          run.callbackCount--;
          run.callbackIds.delete(m.id as string);
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
    await hooks.active();
    const result = await this.send(run, method, input, id);
    await hooks.active();
    return result;
  }
  async cancel(key: string, hooks: EngineHooks, id: string): Promise<void> {
    await hooks.active();
    const run = this.runs.get(key);
    if (!run?.pending.has(id)) return;
    this.write(run, {
      jsonrpc: "2.0",
      method: "$/cancelRequest",
      params: { id },
    });
    const p = run.pending.get(id)!;
    clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      if (run.pending.has(id))
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
