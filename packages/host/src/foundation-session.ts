import { randomUUID, createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import {
  validatePackage,
  PlumsError,
  CAPABILITY_FAILED,
  type PackageFiles,
} from "@plums/core";
import {
  desktopContribution,
  foundationProvider,
  parseFoundationRequirement,
  parseFoundationSelection,
  parseFoundationMessage,
  checkFoundationCompatibility,
  validateContributionValue,
  type FoundationActor,
  type FoundationRequirement,
  type FoundationSelection,
  type FoundationSession,
  type DesktopContribution,
  type ContributionKind,
} from "@plums/sdk";
import {
  ControlledExecution,
  type ControlledProcess,
} from "./controlled-execution.js";
import type { InvocationContext } from "./foundation-runtime.js";
export interface FoundationStartOptions {
  nodePath: string;
  provider: { archive: Uint8Array; selection: FoundationSelection };
  component: { archive: Uint8Array; agentId: string; installationId: string };
  requirement: FoundationRequirement;
  /** Trusted closure performs normal host authorization; no identity comes from provider args. */
  bridge: (
    method: string,
    args: Record<string, unknown>,
    context: InvocationContext,
    actor: Readonly<FoundationActor>,
  ) => Promise<unknown>;
  /** Must check current Agent/install/artifact/selection validity, including after every wait. */
  assertActive: () => Promise<void>;
  hostFeatures?: readonly string[];
  handshakeTimeoutMs?: number;
  callTimeoutMs?: number;
}
const maxFrame = 1024 * 1024;
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const failure = (
  reason: string,
  state: "not_started" | "unknown" | "completed" = "not_started",
  callId?: string,
) =>
  new PlumsError({
    code: CAPABILITY_FAILED,
    message: "底座会话未能完成。",
    details: {
      reason,
      executionState: state,
      phase: "foundation",
      ...(callId ? { callId } : {}),
    },
  });
function budget(value: number | undefined, fallback: number): number {
  const v = value ?? fallback;
  if (!Number.isSafeInteger(v) || v < 1 || v > 120000)
    throw failure("INVALID_REQUEST");
  return v;
}
const methodFeature = (method: string) =>
  method.startsWith("resource.")
    ? "sdk.resources"
    : method.startsWith("protocol.")
      ? "sdk.protocols"
      : method.startsWith("common.")
        ? "sdk.common"
        : method === "emit"
          ? "sdk.events"
          : "sdk." + method;
/** Validated archive bytes are copied before any await; no arbitrary path or worker is accepted. */
export async function startFoundationSession(
  options: FoundationStartOptions,
): Promise<FoundationProcessSession> {
  const providerBytes = new Uint8Array(options.provider.archive),
    componentBytes = new Uint8Array(options.component.archive);
  const selection = parseFoundationSelection(options.provider.selection),
    requirement = parseFoundationRequirement(options.requirement);
  const fixed = {
    ...options,
    component: { ...options.component, archive: componentBytes },
    provider: { archive: providerBytes, selection },
    requirement,
    hostFeatures: [...(options.hostFeatures ?? [])],
  };
  if (
    typeof fixed.assertActive !== "function" ||
    typeof fixed.bridge !== "function" ||
    ![fixed.component.agentId, fixed.component.installationId].every(
      (s) =>
        typeof s === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(s),
    )
  )
    throw failure("INVALID_REQUEST");
  const handshake = budget(fixed.handshakeTimeoutMs, 10000),
    call = budget(fixed.callTimeoutMs, 120000);
  const p = await validatePackage(providerBytes),
    c = await validatePackage(componentBytes),
    provider = foundationProvider(p.manifest, p.files),
    desktop = desktopContribution(c.manifest, c.files);
  if (
    !provider ||
    !desktop?.runtime ||
    selection.id !== provider.id ||
    selection.version !== p.manifest.version ||
    selection.digest !== digest(providerBytes)
  )
    throw failure("STALE_BINDING");
  // SDK identity is not inferred from common.runtime, engine declarations or package entry paths.
  if (
    requirement.sdk.id !== "org.plums.sdk" ||
    requirement.sdk.version !== desktop.sdkVersion + ".0.0"
  )
    throw failure("INCOMPATIBLE");
  const requirements = [
    requirement,
    ...(desktop.foundation ? [desktop.foundation] : []),
  ];
  const features = new Set<string>();
  for (const r of requirements) {
    const compatibility = checkFoundationCompatibility(
      provider,
      r,
      process.platform + "-" + process.arch,
      fixed.hostFeatures,
    );
    if (
      r.sdk.id !== requirement.sdk.id ||
      r.sdk.version !== requirement.sdk.version ||
      !compatibility.compatible
    )
      throw failure("INCOMPATIBLE");
    for (const feature of [
      ...r.features,
      ...(r.optionalFeatures ?? []).filter(
        (feature) => !compatibility.missingOptionalFeatures.includes(feature),
      ),
    ])
      features.add(feature);
  }
  if (desktop.engines?.length) throw failure("INCOMPATIBLE");
  const negotiatedFeatures = [...features];
  const actor = Object.freeze({
    agentId: fixed.component.agentId,
    componentId: c.manifest.id,
    installationId: fixed.component.installationId,
    componentVersion: c.manifest.version,
    componentDigest: digest(componentBytes),
    instanceId: randomUUID(),
  });
  const files = Object.fromEntries(
    Object.entries(c.files).map(([name, bytes]) => [
      name,
      Buffer.from(bytes).toString("utf8"),
    ]),
  );
  const prepare = {
    foundationVersion: "1.0",
    type: "prepare",
    sessionId: actor.instanceId,
    binding: actor,
    provider: selection,
    sdk: requirement.sdk,
    features: negotiatedFeatures,
    extension: {
      entry: desktop.runtime,
      files,
      contributes: desktop.contributes ?? {},
    },
    limits: {
      maxFrameBytes: maxFrame,
      maxCallbacks: 32,
      synchronousMs: 5000,
      memoryMiB: 64,
    },
  };
  if (Buffer.byteLength(JSON.stringify(prepare)) > maxFrame)
    throw failure("LIMIT_EXCEEDED");
  try {
    await fixed.assertActive();
  } catch {
    throw failure("STALE_BINDING");
  }
  const session = new ProcessSession(
    fixed,
    actor,
    desktop,
    negotiatedFeatures,
    handshake,
    call,
  );
  await session.start(p.files, provider.entry, prepare);
  return session;
}
export interface FoundationProcessSession
  extends FoundationSession<InvocationContext> {
  readonly actor: Readonly<FoundationActor>;
  readonly pid?: number;
}
interface Pending {
  dispatched: boolean;
  id: string;
  context: InvocationContext;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  cleanup: () => void;
  callbacks: Set<string>;
  inflight: number;
  failures: Map<string, Error>;
}
/** One process and endpoint for one immutable component installation. */
class ProcessSession implements FoundationSession<InvocationContext> {
  private execution: ControlledExecution;
  private process?: ControlledProcess;
  private stopped = false;
  private cpuStart = 0;
  private cpuWatch?: NodeJS.Timeout;
  private state: "preparing" | "ready" | "activating" | "active" = "preparing";
  private decoder = new StringDecoder("utf8");
  private buffer = "";
  private queue: Promise<unknown> = Promise.resolve();
  private pending?: Pending;
  private readyResolve!: () => void;
  private readyReject!: (e: Error) => void;
  private readiness: Promise<void>;
  private activation?: { resolve: () => void; reject: (e: Error) => void };
  private timer?: NodeJS.Timeout;
  private launchDone: Promise<void> = Promise.resolve();
  constructor(
    private options: FoundationStartOptions,
    readonly actor: Readonly<FoundationActor>,
    private declaration: DesktopContribution,
    private features: string[],
    private handshakeMs: number,
    private callMs: number,
  ) {
    this.execution = new ControlledExecution(options.nodePath);
    this.readiness = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    void this.readiness.catch(() => {});
  }
  get instanceId() {
    return this.actor.instanceId;
  }
  get alive() {
    return !this.stopped;
  }
  get pid() {
    return this.process?.pid;
  }
  async start(files: PackageFiles, entry: string, prepare: unknown) {
    this.launchDone = (async () => {
      this.process = await this.execution.launchFoundation(
        files,
        entry,
        (kind, data) => {
          if (kind === "stdout") this.receiveBytes(data);
        },
        () => this.assertBound(),
      );
      void this.process.done.then(() => this.fail("RUNTIME_UNAVAILABLE"));
      this.cpuWatch = setInterval(() => {
        if ((this.process?.cpuMs ?? 0) - this.cpuStart > 5000)
          this.fail("LIMIT_EXCEEDED");
      }, 50);
      this.timer = setTimeout(
        () => this.fail("DEADLINE_EXCEEDED"),
        this.handshakeMs,
      );
      this.send(prepare);
    })();
    try {
      await this.launchDone;
    } catch {
      this.fail("RUNTIME_UNAVAILABLE");
      await this.execution.close();
      throw failure("RUNTIME_UNAVAILABLE");
    }
  }
  ready() {
    return this.readiness;
  }
  async activate() {
    await this.ready();
    await this.assertBound();
    if (this.stopped || this.state !== "ready") throw failure("NOT_AUTHORIZED");
    this.state = "activating";
    this.cpuStart = this.process?.cpuMs ?? 0;
    await new Promise<void>((resolve, reject) => {
      this.activation = { resolve, reject };
      this.timer = setTimeout(
        () => this.fail("DEADLINE_EXCEEDED"),
        this.handshakeMs,
      );
      this.send({ type: "activate" });
    });
    try {
      await this.assertBound();
    } catch {
      this.fail("STALE_BINDING");
      throw failure("STALE_BINDING");
    }
    if (this.stopped) throw failure("RUNTIME_UNAVAILABLE");
    this.state = "active";
  }
  invoke(
    kind: ContributionKind,
    name: string,
    input: unknown,
    context: InvocationContext,
  ) {
    const declared = this.declaration.contributes?.[kind]?.find(
      (c) => c.name === name,
    );
    if (!declared) return Promise.reject(failure("INVALID_REQUEST"));
    let copy: unknown;
    try {
      copy = structuredClone(input);
    } catch {
      return Promise.reject(failure("INVALID_REQUEST"));
    }
    return this.enqueue(
      { type: "invoke", kind, name, input: copy },
      context,
      declared,
    );
  }
  deliverEvent(topic: string, event: unknown, context: InvocationContext) {
    if (!this.features.includes("sdk.events"))
      return Promise.reject(failure("INCOMPATIBLE"));
    return this.enqueue(
      { type: "event", topic, event: structuredClone(event) },
      context,
    );
  }
  private enqueue(
    message: Record<string, unknown>,
    original: InvocationContext,
    declared?: { inputSchema?: unknown; outputSchema?: unknown },
  ) {
    if (this.state !== "active" || this.stopped)
      return Promise.reject(failure("NOT_AUTHORIZED"));
    // Copy host-owned authority before waiting in the queue, retaining only trusted callbacks/signals.
    const context = {
      ...original,
      callers: structuredClone(original.callers),
      ancestry: [...original.ancestry],
      frontend: original.frontend
        ? structuredClone(original.frontend)
        : undefined,
      grantScope: original.grantScope
        ? structuredClone(original.grantScope)
        : undefined,
    };
    const task = this.queue.then(async () => {
      if (this.stopped || context.signal.aborted) throw failure("CANCELLED");
      try {
        await this.assertBound();
        await context.assertActive?.();
      } catch {
        this.fail("STALE_BINDING");
        throw failure("STALE_BINDING");
      }
      if (this.stopped || context.signal.aborted) throw failure("CANCELLED");
      if (declared?.inputSchema !== undefined)
        validateContributionValue(declared.inputSchema, message.input, "input");
      const id = randomUUID();
      const frame = this.frame({ ...message, callId: id });
      const value = await new Promise<unknown>((resolve, reject) => {
        this.cpuStart = this.process?.cpuMs ?? 0;
        const controller = new AbortController();
        const abort = () => this.fail("CANCELLED");
        const timer = setTimeout(
          () => this.fail("DEADLINE_EXCEEDED"),
          this.callMs,
        );
        const cleanup = () => {
          clearTimeout(timer);
          context.signal.removeEventListener("abort", abort);
          controller.abort();
        };
        context.signal.addEventListener("abort", abort, { once: true });
        this.pending = {
          dispatched: false,
          id,
          context: {
            ...context,
            invocationId: id,
            resourceInstanceId: this.instanceId,
            signal: controller.signal,
          },
          resolve,
          reject,
          cleanup,
          callbacks: new Set(),
          inflight: 0,
          failures: new Map(),
        };
        if (context.signal.aborted) return abort();
        try {
          context.onDispatch?.();
          if (this.stopped || context.signal.aborted) return;
          this.process!.write(frame);
          this.pending!.dispatched = true;
        } catch {
          this.fail("RUNTIME_UNAVAILABLE");
        }
      });
      try {
        await this.assertBound();
        await context.assertActive?.();
      } catch {
        this.fail("STALE_BINDING");
        throw failure("STALE_BINDING", "completed", id);
      }
      if (this.stopped || context.signal.aborted)
        throw failure("CANCELLED", "completed", id);
      if (declared?.outputSchema !== undefined)
        validateContributionValue(declared.outputSchema, value, "output");
      return value;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  private frame(message: unknown) {
    const frame: Record<string, unknown> = {
      foundationVersion: "1.0",
      sessionId: this.instanceId,
      ...(message as object),
    };
    const callId = typeof frame.callId === "string" ? frame.callId : undefined;
    let serialized: string;
    try {
      serialized = JSON.stringify(frame);
    } catch {
      throw failure("INVALID_REQUEST", "not_started", callId);
    }
    if (Buffer.byteLength(serialized) > maxFrame)
      throw failure("LIMIT_EXCEEDED", "not_started", callId);
    return frame;
  }
  private send(message: unknown) {
    this.process!.write(this.frame(message));
  }
  private receiveBytes(data: Buffer) {
    if (this.stopped) return;
    this.buffer += this.decoder.write(data);
    if (Buffer.byteLength(this.buffer) > maxFrame * 2)
      return this.fail("LIMIT_EXCEEDED");
    let end: number;
    while ((end = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (Buffer.byteLength(line) > maxFrame)
        return this.fail("LIMIT_EXCEEDED");
      try {
        this.receive(parseFoundationMessage(JSON.parse(line)));
      } catch {
        this.fail("INVALID_REQUEST");
      }
      if (this.stopped) return;
    }
    if (Buffer.byteLength(this.buffer) > maxFrame) this.fail("LIMIT_EXCEEDED");
  }
  private receive(m: ReturnType<typeof parseFoundationMessage>) {
    if (m.sessionId !== this.instanceId || m.foundationVersion !== "1.0")
      return this.fail("INVALID_REQUEST");
    if (m.type === "ready") {
      if (
        this.state !== "preparing" ||
        m.sdk.id !== this.options.requirement.sdk.id ||
        m.sdk.version !== this.options.requirement.sdk.version ||
        m.features.length !== this.features.length ||
        !this.features.every((f) => m.features.includes(f))
      )
        return this.fail("INCOMPATIBLE");
      clearTimeout(this.timer);
      this.state = "ready";
      this.readyResolve();
      return;
    }
    if (m.type === "activated") {
      if (this.state !== "activating" || !this.activation)
        return this.fail("INVALID_REQUEST");
      clearTimeout(this.timer);
      this.activation.resolve();
      this.activation = undefined;
      return;
    }
    const p = this.pending;
    if (
      m.type === "fatal" ||
      this.state !== "active" ||
      !p ||
      ("callId" in m && m.callId !== p.id)
    )
      return this.fail("INVALID_REQUEST");
    if (m.type === "result") {
      if (p.inflight) return this.fail("INVALID_REQUEST");
      this.pending = undefined;
      p.cleanup();
      if (m.ok) p.resolve(m.value);
      else
        p.reject(
          p.failures.get(
            String((m.value as { failureId?: string } | null)?.failureId),
          ) ?? failure("PROVIDER_FAILED", "completed", p.id),
        );
      return;
    }
    if (
      m.type !== "callback" ||
      !this.features.includes(methodFeature(m.method)) ||
      p.callbacks.has(m.callbackId) ||
      p.inflight >= 32 ||
      p.callbacks.size >= 1024 ||
      [
        "agentId",
        "componentId",
        "installationId",
        "instanceId",
        "callers",
        "ancestry",
        "context",
      ].some((k) => Object.hasOwn(m.args, k))
    )
      return this.fail("INVALID_REQUEST");
    p.callbacks.add(m.callbackId);
    p.inflight++;
    const callback = (async () => {
      try {
        await this.assertBound();
        await p.context.assertActive?.();
        if (this.stopped || this.pending !== p || p.context.signal.aborted)
          throw failure("CANCELLED");
        const value = await this.options.bridge(
          m.method,
          m.args,
          p.context,
          this.actor,
        );
        await this.assertBound();
        await p.context.assertActive?.();
        if (!this.stopped && this.pending === p && !p.context.signal.aborted)
          this.send({
            type: "reply",
            callId: p.id,
            callbackId: m.callbackId,
            ok: true,
            value: value ?? null,
          });
      } catch (e) {
        const failureId = randomUUID();
        p.failures.set(
          failureId,
          e instanceof PlumsError
            ? e
            : failure("NOT_AUTHORIZED", "unknown", p.id),
        );
        if (!this.stopped && this.pending === p && !p.context.signal.aborted)
          try {
            this.send({
              type: "reply",
              callId: p.id,
              callbackId: m.callbackId,
              ok: false,
              value: { code: "HOST_DENIED", failureId },
            });
          } catch {
            this.fail("LIMIT_EXCEEDED");
          }
      } finally {
        p.inflight--;
      }
    })();
    void callback.catch(() => this.fail("INVALID_REQUEST"));
  }
  private async assertBound() {
    try {
      await this.options.assertActive();
    } catch {
      this.fail("STALE_BINDING");
      throw failure("STALE_BINDING");
    }
  }
  private fail(reason: string) {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.cpuWatch);
    const p = this.pending;
    this.pending = undefined;
    p?.cleanup();
    p?.reject(failure(reason, p.dispatched ? "unknown" : "not_started", p.id));
    this.readyReject(failure(reason));
    this.activation?.reject(failure(reason));
    this.activation = undefined;
    void this.process?.stop();
  }
  stop() {
    this.fail("CANCELLED");
  }
  async cancel() {
    this.stop();
    await this.close();
  }
  async close() {
    this.stop();
    await this.launchDone.catch(() => {});
    await this.execution.close();
  }
}
