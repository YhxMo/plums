import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
  statSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { PlumsError } from "@plums/core";
import {
  parseCommonEnvelope,
  type CommonActor,
  type CommonEnvelope,
  type CommonExecutionState,
  type CommonErrorCode,
  type CommonTaskDescription,
  type CommonTaskSnapshot,
} from "@plums/sdk";
import { resourceFailure } from "./resource-error.js";
type Result = Extract<CommonEnvelope, { kind: "result" }>;
interface Task {
  description: CommonTaskDescription;
  snapshot: CommonTaskSnapshot;
  controller: AbortController;
  deadline: number;
  timer?: NodeJS.Timeout;
  reason?: CommonErrorCode;
  origin: string;
  signature: string;
  replies: (CommonEnvelope & { sequence: number })[];
  bytes: number;
  terminalAt?: number;
  terminalDate?: number;
  done?: Promise<void>;
}
/** Durable metadata excludes inputs, outputs and events. Execution is never restored. */
export class CommonTasks {
  private tasks = new Map<string, Task>();
  constructor(private directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    // Validate every record before rewriting or pruning any file.
    const restored: Task[] = [];
    try {
      for (const file of readdirSync(directory).filter((f) =>
        /^[a-f0-9-]{36}\.json$/.test(f),
      )) {
        const location = path.join(directory, file),
          text = readFileSync(location, "utf8");
        if (Buffer.byteLength(text) > 128 * 1024) throw Error();
        const saved = JSON.parse(text),
          id = file.slice(0, -5),
          owner = saved.description?.owner,
          status = saved.snapshot?.status;
        if (
          (saved.metadataVersion !== undefined &&
            saved.metadataVersion !== 1) ||
          saved.description?.taskId !== id ||
          status?.taskId !== id ||
          !["frontend", "agent"].includes(saved.description?.lifetime) ||
          !owner ||
          !["agentId", "componentId", "installId", "instanceId"].every(
            (k) => typeof owner[k] === "string",
          ) ||
          !/^[a-f0-9]{64}$/.test(owner.artifactDigest) ||
          !Number.isSafeInteger(owner.generation) ||
          owner.generation < 0 ||
          ![
            "starting",
            "running",
            "cancelling",
            "stopped",
            "crashed",
            "completed",
          ].includes(status?.state) ||
          !["not_started", "unknown", "completed"].includes(
            status.executionState,
          ) ||
          !Number.isSafeInteger(status.lastSequence) ||
          status.lastSequence < -1 ||
          (status.callId !== undefined && typeof status.callId !== "string") ||
          typeof saved.signature !== "string" ||
          typeof saved.origin !== "string" ||
          (saved.terminalDate !== undefined &&
            (!Number.isSafeInteger(saved.terminalDate) ||
              saved.terminalDate < 0 ||
              saved.terminalDate > Date.now()))
        )
          throw Error();
        let terminalDate =
          saved.terminalDate ?? Math.floor(statSync(location).mtimeMs);
        if (["starting", "running", "cancelling"].includes(status.state)) {
          status.state = "crashed";
          if (status.executionState !== "not_started")
            status.executionState = "unknown";
          terminalDate = Date.now();
        }
        restored.push({
          description: saved.description,
          snapshot: { status },
          signature: saved.signature,
          origin: saved.origin,
          controller: new AbortController(),
          deadline: 0,
          replies: [],
          bytes: 0,
          terminalDate,
          terminalAt:
            performance.now() - Math.max(0, Date.now() - terminalDate),
        });
      }
    } catch {
      throw resourceFailure("RUNTIME_UNAVAILABLE");
    }
    for (const t of restored) this.tasks.set(t.description.taskId, t);
    this.prune();
    for (const t of this.tasks.values()) this.save(t);
  }
  /** Recent replay and active work survive; older status is bounded and never re-executed. */
  private prune() {
    const counts = new Map<string, number>();
    let total = 0;
    const protectedTask = (t: Task) =>
      t.terminalAt === undefined || performance.now() - t.terminalAt < 300000;
    for (const t of this.tasks.values())
      if (protectedTask(t)) {
        counts.set(
          t.description.owner.agentId,
          (counts.get(t.description.owner.agentId) ?? 0) + 1,
        );
        total++;
      }
    for (const t of [...this.tasks.values()]
      .filter((t) => !protectedTask(t))
      .sort(
        (a, b) =>
          b.terminalDate! - a.terminalDate! ||
          a.description.taskId.localeCompare(b.description.taskId),
      )) {
      t.replies = [];
      t.bytes = 0;
      delete t.snapshot.result;
      const agent = t.description.owner.agentId,
        count = counts.get(agent) ?? 0;
      if (
        Date.now() - t.terminalDate! > 30 * 86400000 ||
        count >= 256 ||
        total >= 1024
      ) {
        rmSync(path.join(this.directory, t.description.taskId + ".json"), {
          force: true,
        });
        this.tasks.delete(t.description.taskId);
      } else {
        counts.set(agent, count + 1);
        total++;
      }
    }
  }

  private save(t: Task) {
    const file = path.join(this.directory, t.description.taskId + ".json"),
      temp = file + "." + randomUUID();
    writeFileSync(
      temp,
      JSON.stringify({
        metadataVersion: 1,
        ...(t.terminalDate !== undefined
          ? { terminalDate: t.terminalDate }
          : {}),
        description: t.description,
        snapshot: { status: t.snapshot.status },
        signature: t.signature,
        origin: t.origin,
      }),
      { mode: 0o600 },
    );
    const fd = openSync(temp, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, file);
    const dir = openSync(this.directory, "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  }
  create(
    owner: CommonActor,
    signature: string,
    origin: string,
    lifetime: "frontend" | "agent",
    timeoutMs = 120000,
  ) {
    if (
      !["frontend", "agent"].includes(lifetime) ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 3600000
    )
      throw resourceFailure("INVALID_REQUEST");
    if (
      [...this.tasks.values()].filter(
        (t) =>
          t.description.owner.agentId === owner.agentId &&
          (t.terminalAt === undefined ||
            performance.now() - t.terminalAt < 300000),
      ).length >= 256
    )
      throw resourceFailure("LIMIT_EXCEEDED");
    this.prune();
    const taskId = randomUUID();
    const t: Task = {
      description: { taskId, lifetime, owner: structuredClone(owner) },
      snapshot: {
        status: {
          taskId,
          state: "starting",
          executionState: "not_started",
          lastSequence: -1,
        },
      },
      signature,
      origin,
      controller: new AbortController(),
      deadline: performance.now() + timeoutMs,
      replies: [],
      bytes: 0,
    };
    if (
      [...this.tasks.values()].filter(
        (t) =>
          t.terminalAt === undefined ||
          performance.now() - t.terminalAt < 300000,
      ).length >= 1024
    )
      throw resourceFailure("LIMIT_EXCEEDED");
    this.tasks.set(taskId, t);
    this.save(t);
    t.timer = setTimeout(
      () => void this.cancel(t, "DEADLINE_EXCEEDED"),
      timeoutMs,
    );
    t.timer.unref();
    return structuredClone(t.description);
  }
  shorten(
    id: string,
    owner: CommonActor,
    signature: string,
    timeoutMs?: number,
  ) {
    if (timeoutMs === undefined) return;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000)
      throw resourceFailure("INVALID_REQUEST");
    const t = this.get(id, owner, signature),
      deadline = performance.now() + timeoutMs;
    if (deadline < t.deadline) {
      t.deadline = deadline;
      clearTimeout(t.timer);
      t.timer = setTimeout(
        () => void this.cancel(t, "DEADLINE_EXCEEDED"),
        timeoutMs,
      );
      t.timer.unref();
    }
  }
  private get(id: string, owner: CommonActor, signature: string) {
    const t = this.tasks.get(id);
    if (
      !t ||
      t.description.owner.agentId !== owner.agentId ||
      t.description.owner.componentId !== owner.componentId ||
      t.signature !== signature
    )
      throw resourceFailure("NOT_AUTHORIZED");
    if (
      t.terminalAt !== undefined &&
      performance.now() - t.terminalAt > 300000
    ) {
      t.replies = [];
      t.bytes = 0;
      delete t.snapshot.result;
    }
    return t;
  }
  status(id: string, owner: CommonActor, signature: string) {
    return structuredClone(this.get(id, owner, signature).snapshot);
  }
  deadlineFor(agentId: string, id: string): number {
    const task = this.tasks.get(id);
    if (!task || task.description.owner.agentId !== agentId)
      throw resourceFailure("STALE_BINDING");
    return Date.now() + Math.max(0, task.deadline - performance.now());
  }
  describe(id: string, owner: CommonActor, signature: string) {
    return structuredClone(this.get(id, owner, signature).description);
  }
  async start(
    id: string,
    owner: CommonActor,
    signature: string,
    callId: string,
    run: (
      signal: AbortSignal,
      started: () => void,
      emit: (channel: string, data: unknown) => Promise<void>,
    ) => Promise<unknown>,
  ) {
    const t = this.get(id, owner, signature);
    if (
      t.snapshot.status.callId ||
      t.controller.signal.aborted ||
      t.terminalAt !== undefined ||
      performance.now() >= t.deadline
    )
      throw resourceFailure("STALE_BINDING");
    t.snapshot.status.callId = callId;
    t.snapshot.status.state = "starting";
    this.push(t, {
      commonVersion: "1.0",
      kind: "accepted",
      callId,
      sequence: 0,
      taskId: id,
    });
    t.done = (async () => {
      try {
        const value = await run(
          t.controller.signal,
          () => {
            t.snapshot.status.state = "running";
            t.snapshot.status.executionState = "unknown";
            this.save(t);
          },
          (channel, data) => this.emit(t, channel, data),
        );
        if (t.controller.signal.aborted)
          throw resourceFailure(
            "CANCELLED",
            callId,
            t.snapshot.status.executionState,
          );
        this.finish(t, {
          commonVersion: "1.0",
          kind: "result",
          callId,
          sequence: t.snapshot.status.lastSequence + 1,
          executionState: "completed",
          outcome: { ok: true, value: value as never },
        });
      } catch (e) {
        let code: CommonErrorCode = "PROVIDER_FAILED",
          state = t.snapshot.status.executionState;
        if (e instanceof PlumsError) {
          const d = e.details as
            | {
                reason?: CommonErrorCode;
                executionState?: CommonExecutionState;
              }
            | undefined;
          if (d?.reason) code = d.reason;
          if (d?.executionState === "completed") state = "completed";
        }
        if (t.controller.signal.aborted) code = t.reason ?? "CANCELLED";
        // Only common error codes cross the transport; rejected values/errors never do.
        try {
          this.finish(t, {
            commonVersion: "1.0",
            kind: "result",
            callId,
            sequence: t.snapshot.status.lastSequence + 1,
            executionState: state,
            outcome: { ok: false, error: { code } },
          });
        } catch {
          this.finish(t, {
            commonVersion: "1.0",
            kind: "result",
            callId,
            sequence: t.snapshot.status.lastSequence + 1,
            executionState: state,
            outcome: { ok: false, error: { code: "PROVIDER_FAILED" } },
          });
        }
      }
    })();
    void t.done.catch(() => {});
    return { callId, taskId: id };
  }
  private push(t: Task, raw: CommonEnvelope) {
    const m = parseCommonEnvelope(raw) as CommonEnvelope & { sequence: number };
    t.snapshot.status.lastSequence = m.sequence;
    t.replies.push(m);
    t.bytes += Buffer.byteLength(JSON.stringify(m));
    while (t.replies.length > 256 || t.bytes > 8 * 1024 * 1024) {
      const removed = t.replies.shift()!;
      t.bytes -= Buffer.byteLength(JSON.stringify(removed));
    }
    this.save(t);
  }
  private async emit(t: Task, channel: string, data: unknown) {
    if (t.controller.signal.aborted) throw resourceFailure("CANCELLED");
    const message = parseCommonEnvelope({
      commonVersion: "1.0",
      kind: "event",
      callId: t.snapshot.status.callId!,
      sequence: t.snapshot.status.lastSequence + 1,
      channel,
      data: data as never,
    });
    if (
      t.replies.length >= 256 ||
      t.bytes + Buffer.byteLength(JSON.stringify(message)) > 8 * 1024 * 1024
    ) {
      void this.cancel(t, "LIMIT_EXCEEDED");
      throw resourceFailure("LIMIT_EXCEEDED");
    }
    this.push(t, message);
  }
  emitCall(taskId: string, channel: string, data: unknown) {
    const t = this.tasks.get(taskId);
    if (!t) throw resourceFailure("STALE_BINDING");
    return this.emit(t, channel, data);
  }
  private finish(t: Task, result: Result) {
    if (t.terminalAt !== undefined) return;
    clearTimeout(t.timer);
    t.snapshot.result = parseCommonEnvelope(result) as Result;
    t.snapshot.status.executionState = result.executionState;
    t.snapshot.status.state = t.controller.signal.aborted
      ? "stopped"
      : result.outcome.ok
        ? "completed"
        : "crashed";
    t.terminalAt = performance.now();
    t.terminalDate = Date.now();
    this.push(t, result);
    const expire = setTimeout(() => {
      t.replies = [];
      t.bytes = 0;
      delete t.snapshot.result;
    }, 300000);
    expire.unref();
  }
  poll(id: string, owner: CommonActor, signature: string, after: number) {
    const t = this.get(id, owner, signature);
    if (
      !Number.isInteger(after) ||
      after < -1 ||
      after > t.snapshot.status.lastSequence
    )
      throw resourceFailure("INVALID_REQUEST");
    if (
      (t.replies[0]?.sequence ?? t.snapshot.status.lastSequence + 1) >
      after + 1
    )
      throw resourceFailure("REPLAY_GAP");
    const messages = t.replies.filter((m) => m.sequence > after).slice(0, 32);
    return {
      messages: structuredClone(messages),
      snapshot: structuredClone(t.snapshot),
    };
  }
  acknowledge(
    id: string,
    owner: CommonActor,
    signature: string,
    sequence: number,
  ) {
    const t = this.get(id, owner, signature);
    if (
      !Number.isInteger(sequence) ||
      sequence < 0 ||
      sequence > t.snapshot.status.lastSequence
    )
      throw resourceFailure("INVALID_REQUEST");
    // Keep a bounded replay tail; producer occupancy is measured since acknowledgement.
    const messages = t.replies.filter((m) => m.sequence > sequence);
    if (messages.length >= 256) throw resourceFailure("LIMIT_EXCEEDED");
    const firstRetained = Math.max(0, sequence - 127);
    while (t.replies[0] && t.replies[0].sequence < firstRetained) {
      t.bytes -= Buffer.byteLength(JSON.stringify(t.replies.shift()!));
    }
  }
  private async cancel(t: Task, reason: CommonErrorCode = "CANCELLED") {
    if (t.terminalAt !== undefined) return;
    if (t.controller.signal.aborted) {
      await t.done;
      return;
    }
    t.reason = reason;
    t.snapshot.status.state = "cancelling";
    this.save(t);
    t.controller.abort();
    await t.done;
    if (t.terminalAt === undefined) {
      clearTimeout(t.timer);
      t.snapshot.status.state = "stopped";
      t.terminalAt = performance.now();
      t.terminalDate = Date.now();
      this.save(t);
    }
  }
  async stop(id: string, owner: CommonActor, signature: string) {
    await this.cancel(this.get(id, owner, signature));
  }
  async stopAgent(agentId: string) {
    const owned = [...this.tasks.values()].filter(
      (t) => t.description.owner.agentId === agentId,
    );
    await Promise.all(owned.map((t) => this.cancel(t)));
    // Revocation/binding changes keep metadata, never prior business replies.
    for (const t of owned) {
      t.replies = [];
      t.bytes = 0;
      delete t.snapshot.result;
    }
  }
  closeOrigin(origin: string) {
    void Promise.all(
      [...this.tasks.values()]
        .filter(
          (t) => t.origin === origin && t.description.lifetime === "frontend",
        )
        .map((t) => this.cancel(t)),
    );
  }
  hasBackground(agentId: string) {
    return [...this.tasks.values()].some(
      (t) =>
        t.description.owner.agentId === agentId &&
        t.description.lifetime === "agent" &&
        t.terminalAt === undefined,
    );
  }
  isActive(taskId: string) {
    const task = this.tasks.get(taskId);
    return task !== undefined && task.terminalAt === undefined;
  }
  list(agentId: string) {
    this.prune();
    return [...this.tasks.values()]
      .filter((t) => t.description.owner.agentId === agentId)
      .map((t) => ({
        description: structuredClone(t.description),
        snapshot: structuredClone(t.snapshot),
      }));
  }
}
