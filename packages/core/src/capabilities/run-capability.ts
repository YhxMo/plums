import type { TaskScopes } from "./task-scope.js";
import { copyJson, resolveService, type RegisteredService, type ServiceScope } from "./services.js";
import { randomUUID } from "node:crypto";
import { SinkFailure } from "./sink-failure.js";
import { CAPABILITY_FAILED, CONFIRMATION_DENIED, CONSENT_REQUIRED, PERMISSION_DENIED, PlumsError } from "../errors.js";
import { requireInstalled, requireManifest, type InstallContext } from "../install/lifecycle.js";
import { knownSecrets } from "../install/settings.js";
import { matchEgressUrl } from "../package/egress-target.js";
import { isManifestV2, type PermissionV2 } from "../package/types.js";
import { redact } from "../redact.js";
import type { Confirm, ConfirmRequest, EgressSink } from "../types.js";
import { resolveLocation } from "./fs-boundary.js";
import { copyInput } from "./request.js";
import type { AuditEvent, AuditHandler, CapabilityResult, ExecutionState, ExecSink, FsLocation, FsSink, RunCapabilityInput, CapabilityCaller } from "./types.js";

export interface CapabilityContext extends InstallContext {
  instanceId: string;
  services: ReadonlyMap<string, RegisteredService>;
  tasks?: TaskScopes;
  roots: ReadonlyMap<string, string>;
  programs: ReadonlyMap<string, string>;
  fs?: FsSink;
  exec?: ExecSink;
  egress: EgressSink;
  confirm?: Confirm;
  confirmTimeoutMs: number;
  onAudit?: AuditHandler;
}
interface Authorized {
  permission: PermissionV2;
  index: number;
  name: string;
}
interface Scope {
  service?: ServiceScope;
  location?: FsLocation;
  program?: string;
  url?: string;
  host?: string;
}

function refuse(reason: string, at = "/permissions"): never {
  throw new PlumsError({ code: PERMISSION_DENIED, message: "这次能力调用不在当前授权范围内，没有执行。", path: at, details: { reason } });
}
function authorize(ctx: CapabilityContext, input: RunCapabilityInput, allowConnector = false): Authorized {
  const installed = requireInstalled(ctx, input.extensionId);
  if (!installed.enabled) refuse("NOT_ENABLED");
  const manifest = requireManifest(ctx, input.extensionId);
  if (!isManifestV2(manifest)) refuse("FORMAT_API_MISMATCH", "/formatVersion");
  if (manifest.kind !== "extension" && !(allowConnector && manifest.kind === "connector")) refuse("NOT_EXTENSION", "/kind");
  const index = manifest.permissions.findIndex((p) => p.id === input.permissionId);
  const permission = manifest.permissions[index];
  if (permission === undefined) refuse("PERMISSION_NOT_DECLARED");
  const consent = ctx.store.getConsent(input.extensionId);
  const covered = consent?.formatVersion.startsWith("2.") && (consent.permissions as PermissionV2[]).some((p) =>
    p.id === permission.id && p.target === permission.target && p.kind === permission.kind &&
    (permission.kind !== "fs" || (p.kind === "fs" && permission.operations.every((op) => p.operations.includes(op)))) &&
    (permission.kind !== "exec" || (p.kind === "exec" && permission.cwdRoots.every((root) => p.cwdRoots.includes(root)))) &&
    (permission.kind !== "service" || (p.kind === "service" && permission.operations.every((op) => p.operations.includes(op)))));
  if (!covered) throw new PlumsError({ code: CONSENT_REQUIRED, message: "这次能力调用还没有得到对当前权限的同意。", path: `/permissions/${index}`, details: { reason: consent === undefined ? "NO_CONSENT" : "PERMISSION_NOT_CONSENTED" } });
  return { permission, index, name: installed.name };
}

async function scope(ctx: CapabilityContext, { permission, index }: Authorized, input: RunCapabilityInput): Promise<Scope> {
  const {request} = input;
  if (request.kind !== permission.kind) refuse("KIND_MISMATCH", `/permissions/${index}/kind`);
  if (request.kind === "service" && permission.kind === "service") {
    const service = await resolveService(ctx, input, permission);
    return { service, ...(service.host ? {host:service.host} : {}) };
  }
  if (request.kind === "fs" && permission.kind === "fs") {
    if (!permission.operations.includes(request.operation)) refuse("OPERATION_NOT_ALLOWED", "/request/operation");
    const root = ctx.roots.get(permission.target);
    if (root === undefined) refuse("ROOT_NOT_BOUND", `/permissions/${index}/target`);
    if (ctx.fs === undefined) refuse("SINK_NOT_CONFIGURED");
    return { location: await resolveLocation(root, request.path, request.operation) };
  }
  if (request.kind === "exec" && permission.kind === "exec") {
    const program = ctx.programs.get(permission.target);
    if (program === undefined) refuse("PROGRAM_NOT_BOUND", `/permissions/${index}/target`);
    if (!permission.cwdRoots.includes(request.cwd.root)) refuse("CWD_ROOT_NOT_ALLOWED", "/request/cwd/root");
    const root = ctx.roots.get(request.cwd.root);
    if (root === undefined) refuse("ROOT_NOT_BOUND", "/request/cwd/root");
    if (ctx.exec === undefined) refuse("SINK_NOT_CONFIGURED");
    return { program, location: await resolveLocation(root, request.cwd.path, "cwd") };
  }
  if (request.kind === "egress" && permission.kind === "egress") {
    const parsed = matchEgressUrl(permission.target, request.url);
    if (parsed === undefined) refuse("URL_NOT_ALLOWED", "/request/url");
    return { url: parsed.href, host: parsed.host };
  }
  return refuse("KIND_MISMATCH");
}

function declaration(permission: PermissionV2): string {
  return JSON.stringify([permission.kind, permission.target, permission.reason,
    (permission.kind === "fs" || permission.kind === "service") ? [...permission.operations].sort() : permission.kind === "exec" ? [...permission.cwdRoots].sort() : []]);
}
function sameScope(first: Scope, next: Scope): boolean {
  return first.service?.service === next.service?.service && first.service?.bindingFingerprint === next.service?.bindingFingerprint && first.service?.effect === next.service?.effect && first.host === next.host && first.program === next.program && first.url === next.url &&
    first.location?.rootPath === next.location?.rootPath && first.location?.path === next.location?.path;
}

type Answer = "allowed" | "denied" | "timeout" | "error" | "missing" | "invalid";
const outbound = (effect: string | undefined) => effect === "egress" || effect === "model-egress";
async function ask(confirm: Confirm | undefined, request: ConfirmRequest, timeoutMs: number): Promise<Answer> {
  if (confirm === undefined) return "missing";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Attach both handlers even if the timer wins: a late rejection is consumed.
    const answer = Promise.resolve().then(() => confirm.ask(request)).then(
      (value): Answer => value === true ? "allowed" : value === false ? "denied" : "invalid",
      (): Answer => "error",
    );
    return await Promise.race([answer, new Promise<Answer>((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

function failure(callId: string, phase: string, executionState: ExecutionState, known?: NonNullable<ReturnType<typeof SinkFailure.describe>>): PlumsError {
  return new PlumsError({
    code: CAPABILITY_FAILED,
    message: known?.message ?? (executionState === "completed" ? "动作已完成，但结果审计失败。请勿自动重试。" : executionState === "unknown" ? "执行结果无法确定，请核对宿主记录，勿自动重试。" : "能力调用失败，动作没有执行。"),
    details: { callId, phase, executionState, ...(known ? { reason: known.reason, ...(known.httpStatus === undefined ? {} : {httpStatus:known.httpStatus}) } : {}) },
  });
}

/** No model loop or third-party execution: authorization and one injected sink call. */
export async function runCapability(ctx: CapabilityContext, rawInput: RunCapabilityInput, delegates: readonly CapabilityCaller[] = [], allowConnector = false, additionalGate?: () => void): Promise<CapabilityResult> {
  const callId = randomUUID();
  let state: ExecutionState = "not_started";
  let input: RunCapabilityInput;
  let copied = false;
  let meta: Pick<AuditEvent, "taskId" | "callerIds" | "extensionId" | "permissionId" | "kind" | "operation" | "target"> = {};
  const secrets = new Set<string>();
  let firstSecrets: Promise<string[] | undefined> | undefined;
  const emit = async (phase: AuditEvent["phase"], outcome: AuditEvent["outcome"], code?: string, reason?: string): Promise<void> => {
    try {
      if (ctx.onAudit === undefined) throw new Error();
      if (firstSecrets !== undefined) {
        const values = await firstSecrets;
        if (values === undefined) throw new Error();
        for (const secret of values) secrets.add(secret);
      }
      for (const secret of await knownSecrets(ctx)) secrets.add(secret);
      const event: AuditEvent = { ...meta, callId, timestamp: new Date().toISOString(), phase, outcome, executionState: state, ...(code ? { code } : {}), ...(reason ? { reason } : {}) };
      const safeEvent=redact(event, [...secrets]) as AuditEvent;
      if(safeEvent.callerIds)Object.freeze(safeEvent.callerIds);
      await ctx.onAudit(Object.freeze(safeEvent));
    } catch { throw failure(callId, `audit_${phase}`, state); }
  };
  try {
    // Malicious accessors must not put their exception or rejected values in the error.
    try { input = copyInput(rawInput); } catch (error) {
      throw error instanceof PlumsError ? error : new TypeError("runCapability requires a valid capability request");
    }
    copied = true;
    meta = { extensionId: input.extensionId, permissionId: input.permissionId, kind: input.request.kind,
      operation: (input.request.kind === "fs" || input.request.kind === "service") ? input.request.operation : input.request.kind === "exec" ? "run" : "send" };
    // Start reading while references still exist, before metadata checks can yield to uninstall.
    // Consume failures immediately; emit reports them with its phase and execution state.
    firstSecrets = knownSecrets(ctx).catch(() => undefined);
    const taskCheckpoint = ctx.tasks?.checkpoint();
    const initial = authorize(ctx, input, allowConnector);
    additionalGate?.();
    const initialDelegates = delegates.map((caller) => authorize(ctx, { ...input, extensionId: caller.packageId, permissionId: caller.permissionId }, true));
    const delegateScopes = new Map<number, Scope>();
    const checkDelegates = async (): Promise<void> => {
      for (let i = 0; i < delegates.length; i += 1) {
        const caller = delegates[i]!;
        const call = { ...input, extensionId: caller.packageId, permissionId: caller.permissionId };
        const next = authorize(ctx, call, true);
        if (declaration(next.permission) !== declaration(initialDelegates[i]!.permission)) refuse("PERMISSION_CHANGED");
        const allowed = await scope(ctx, next, call);
        const previous = delegateScopes.get(i);
        if (previous && (previous.service?.fingerprint !== allowed.service?.fingerprint || previous.service?.revision !== allowed.service?.revision)) refuse("DELEGATION_SCOPE_CHANGED");
        delegateScopes.set(i, allowed);
        if (!sameScope(initialScope, allowed)) refuse("DELEGATION_SCOPE_MISMATCH");
      }
      for (let i = 0; i < delegates.length; i += 1) {
        const caller = delegates[i]!;
        const next = authorize(ctx, { ...input, extensionId: caller.packageId, permissionId: caller.permissionId }, true);
        if (declaration(next.permission) !== declaration(initialDelegates[i]!.permission)) refuse("PERMISSION_CHANGED");
      }
      additionalGate?.();
    };
    meta.target = initial.permission.target;
    if (delegates.length) meta.callerIds = delegates.map((c) => c.packageId);
    const initialScope = await scope(ctx, initial, input);
    await checkDelegates();
    const principals = [{ packageId: input.extensionId, permissionId: input.permissionId }, ...delegates];
    const task = (input.request.kind === "exec" || (input.request.kind === "service" && !outbound(initialScope.service?.effect))) ? undefined : ctx.tasks?.covers(principals, input.request);
    if (task) meta.taskId = task.taskId;
    const recheck = async (): Promise<Scope> => {
      taskCheckpoint?.();
      if (task && ctx.tasks?.covers(principals, input.request)?.taskId !== task.taskId) refuse("TASK_SCOPE_CHANGED");
      const next = authorize(ctx, input, allowConnector);
      if (declaration(next.permission) !== declaration(initial.permission)) refuse("PERMISSION_CHANGED", `/permissions/${next.index}`);
      const checked = await scope(ctx, next, input);
      if (checked.service?.fingerprint !== initialScope.service?.fingerprint || checked.service?.revision !== initialScope.service?.revision) refuse("SERVICE_SCOPE_CHANGED");
      if (!sameScope(initialScope, checked)) refuse("PATH_CHANGED", input.request.kind === "exec" ? "/request/cwd/path" : "/request/path");
      // scope reads metadata asynchronously, so check state once more after it returns.
      await checkDelegates();
      const final = authorize(ctx, input, allowConnector);
      if (declaration(final.permission) !== declaration(initial.permission)) refuse("PERMISSION_CHANGED", `/permissions/${final.index}`);
      taskCheckpoint?.();
      if (task && ctx.tasks?.covers(principals, input.request)?.taskId !== task.taskId) refuse("TASK_SCOPE_CHANGED");
      return checked;
    };
    if (input.request.kind === "service" ? initialScope.service?.effect === "external-write" || (outbound(initialScope.service?.effect) && !task) : !task && (ctx.tasks?.requiresApproval() || input.request.kind !== "fs" || input.request.operation === "write")) {
      await emit("confirmation", "requested");
      const { permission, name } = initial;
      const action = permission.kind === "fs" ? `${input.request.kind === "fs" ? { read: "读取", list: "列出", write: "写入" }[input.request.operation] : "访问"}目录 ${permission.target} 内的文件` : permission.kind === "service" ? outbound(initialScope.service?.effect) ? `把数据发送到 ${initialScope.host ?? permission.target}` : `通过服务 ${permission.target} 修改外部数据` : permission.kind === "exec" ? `运行程序 ${permission.target}` : `把数据发送到 ${initialScope.host}`;
      const safeRequest = redact({ subject: name, action: `「${name}」想${action}。`, message: `「${name}」想${action}。原因:${permission.reason}。允许吗?`, reason: permission.reason, ...(initialScope.host ? { host: initialScope.host } : {}) }, [...secrets]) as ConfirmRequest;
      const answer = await ask(ctx.confirm, safeRequest, ctx.confirmTimeoutMs);
      await emit("confirmation", answer);
      if (answer !== "allowed") throw new PlumsError({ code: CONFIRMATION_DENIED, message: "没有得到明确确认，这次能力调用没有执行。", path: `/permissions/${initial.index}`, details: { reason: answer.toUpperCase() } });
    }
    await recheck();
    await emit("allow", "allowed");
    // An asynchronous audit callback can itself change package state or filesystem paths.
    const allowed = await recheck();
    state = "unknown";
    let result: CapabilityResult;
    try { result = await execute(ctx, input, allowed, callId, recheck); } catch (error) {
      const known = SinkFailure.describe(error);
      if (known) state = known.executionState;
      await emit("result", "failed", CAPABILITY_FAILED, known?.reason ?? "SINK_FAILED");
      throw failure(callId, "sink", state, known);
    }
    state = "completed";
    await emit("result", "completed");
    if (input.request.kind === "service") { try { await recheck(); } catch { throw failure(callId,"result_authorization",state); } }
    return result;
  } catch (error) {
    if (error instanceof PlumsError && error.code === CAPABILITY_FAILED) throw secrets.size === 0 ? error : redact(error, [...secrets]);
    const safeError = error instanceof PlumsError || (!copied && error instanceof TypeError) ? error : failure(callId, "authorization", state);
    await emit("denied", "denied", safeError instanceof PlumsError ? safeError.code : "REQUEST_INVALID");
    // Invalid request messages are fixed text; keep their public TypeError identity.
    throw safeError instanceof TypeError || secrets.size === 0 ? safeError : redact(safeError, [...secrets]);
  }
}

async function execute(ctx: CapabilityContext, input: RunCapabilityInput, allowed: Scope, callId: string, recheck: () => Promise<Scope>): Promise<CapabilityResult> {
  const {request} = input;
  if (request.kind === "service") {
    const result = await allowed.service!.service.invoke({instanceId:ctx.instanceId, packageId:input.extensionId, operation:request.operation, binding:request.binding, sources:Object.freeze([...request.sources]), input:request.input, signal:input.signal, assertActive:async()=>{await recheck();}});
    await recheck();
    return {callId,kind:"service",operation:request.operation,result:copyJson(result)};
  }
  if (request.kind === "fs") {
    const location = allowed.location!;
    if (request.operation === "write") {
      await ctx.fs!.write({ ...location, data: new Uint8Array(request.data) });
      return { callId, kind: "fs", operation: "write", completed: true };
    }
    if (request.operation === "read") {
      const data = await ctx.fs!.read({ ...location });
      if (!(data instanceof Uint8Array)) throw new TypeError();
      return { callId, kind: "fs", operation: "read", data: new Uint8Array(data) };
    }
    const entries = await ctx.fs!.list({ ...location });
    if (!Array.isArray(entries)) throw new TypeError();
    const copied = Array.from(entries, (entry) => {
      const { name, type } = entry;
      if (typeof name !== "string" || name.length === 0 || /[\\/\0]/.test(name) || name === "." || name === ".." || !["file", "directory", "symlink", "other"].includes(type)) throw new TypeError();
      return { name, type };
    });
    return { callId, kind: "fs", operation: "list", entries: copied };
  }
  if (request.kind === "exec") {
    const result = await ctx.exec!.run({ program: allowed.program!, args: [...request.args], cwd: allowed.location!.path, rootPath: allowed.location!.rootPath });
    if (!Number.isInteger(result.exitCode) || typeof result.stdout !== "string" || typeof result.stderr !== "string") throw new TypeError();
    return { callId, kind: "exec", result: { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr } };
  }
  const result = await ctx.egress.send({ url: allowed.url!, ...(request.method !== undefined ? { method: request.method } : {}), ...(request.body !== undefined ? { body: request.body } : {}), ...(request.headers ? { headers: { ...request.headers } } : {}), ...(request.stream !== undefined ? { stream: request.stream } : {}) });
  if (!Number.isInteger(result.status) || typeof result.body !== "string" || (result.redirectTo !== undefined && typeof result.redirectTo !== "string")) throw new TypeError();
  if (result.headers && Object.values(result.headers).some((v) => typeof v !== "string")) throw new TypeError();
  return { callId, kind: "egress", result: { ...(result.headers ? { headers: { ...result.headers } } : {}), status: result.status, body: result.body, ...(result.redirectTo !== undefined ? { redirectTo: result.redirectTo } : {}) } };
}
