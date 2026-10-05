import {
  isManifestV2,
  redact,
  PlumsError,
  PERMISSION_DENIED,
  type CapabilityRequest,
  type McpTool,
  type AuditEvent,
} from "@plums/core";
import { desktopContribution, type ContributionKind } from "@plums/sdk";
import { ioContext } from "./io.js";
import { configuredConnection } from "./connection-service.js";
import { CAPABILITY_FAILED, SinkFailure } from "@plums/core";
import type { Session, HostOptions } from "./host.js";
import type { ExtensionRuntime, InvocationContext } from "./runtime.js";
function denied(): never {
  throw new PlumsError({
    code: PERMISSION_DENIED,
    message: "请求不属于当前 Agent 或已声明接口。",
  });
}
interface Hooks {
  secretValues: () => Promise<string[]>;
  engine:(method:string,args:Record<string,unknown>)=>Promise<unknown>;
  audit:(event:AuditEvent)=>Promise<void>;
  event: HostOptions["event"];
  runtime: (packageId: string) => Promise<ExtensionRuntime>;
}
export async function dispatchSdk(
  s: Session,
  packageId: string,
  method: string,
  args: Record<string, unknown>,
  context: InvocationContext,
  hooks: Hooks,
): Promise<unknown> {
  if (context.signal.aborted || s.controller.signal.aborted) denied();
  const current = await s.core.getPackage(packageId);
  if (!current.installed.enabled) denied();
  if (["context", "connection", "failResponse"].includes(method) && desktopContribution(current.manifest)?.sdkVersion !== "2") denied();
  if(method.startsWith("engine.")) {if(desktopContribution(current.manifest)?.sdkVersion!=="2") denied();return redact(await hooks.engine(method,args),await hooks.secretValues());}
  switch (method) {
    case "context": return { agentId: s.record.instanceId, componentId: packageId, invocationId: context.invocationId };
    case "connection": {
      if (typeof args.id !== "string") denied();
      const b = await configuredConnection(s.core, packageId, args.id);
      if (!b) denied();
      return { binding: b.binding, baseURL: b.baseURL, origin: b.origin, basePath: new URL(b.baseURL).pathname, fingerprint: b.fingerprint, ready: b.ready };
    }
    case "failResponse": {
      if (typeof args.callId !== "string" || !["RESPONSE_INVALID", "HTTP_REJECTED"].includes(args.reason as string)) denied();
      const receipt = s.receipts.get(args.callId);
      if (!receipt || receipt.packageId !== packageId || receipt.invocationId !== context.invocationId ||
        (args.reason === "HTTP_REJECTED" && receipt.status >= 200 && receipt.status < 300)) denied();
      s.receipts.delete(args.callId);
      try { await hooks.audit({callId:args.callId,timestamp:new Date().toISOString(),extensionId:packageId,kind:"service",operation:"request",phase:"result",outcome:"failed",executionState:"completed",reason:args.reason as string}); } catch { throw new PlumsError({code:CAPABILITY_FAILED,message:"Response failure audit could not be saved.",details:{callId:args.callId,phase:"audit",executionState:"completed",reason:"AUDIT_FAILED",httpStatus:receipt.status}}); }
      const error = new SinkFailure(args.reason as "RESPONSE_INVALID" | "HTTP_REJECTED", receipt.status);
      throw new PlumsError({ code: CAPABILITY_FAILED, message: error.message, details: { callId: args.callId, phase: "sink", executionState: "completed", reason: args.reason, httpStatus: receipt.status } });
    }
    case "characters": {
      const cards = (await s.core.listInstalled()).filter(
        (p) => p.kind === "character" && p.enabled,
      );
      return cards.map(({ id, name, version }) => ({ id, name, version }));
    }
    case "character": {
      const id =
        args.packageId === undefined ? s.record.characterId : args.packageId;
      if (id === undefined) return null;
      if (typeof id !== "string") denied();
      const card = (await s.core.listInstalled()).find(
        (p) => p.id === id && p.kind === "character" && p.enabled,
      );
      if (!card) {
        if (args.packageId === undefined) return null;
        denied();
      }
      return redact(
        (await s.core.getPackage(id)).manifest.payload,
        await hooks.secretValues(),
      );
    }
    case "settings":
      return (await s.core.describeSettings(packageId)).values;
    case "emit": {
      if (
        typeof args.topic !== "string" ||
        !/^[a-zA-Z0-9_.-]{1,64}$/.test(args.topic)
      )
        denied();
      const data = redact(args.data, await hooks.secretValues());
      hooks.event?.(s.record.instanceId, packageId, args.topic, data);
      if (context.ancestry.length < 16)
        for (const [target, runtime] of s.runtimes)
          if (!context.ancestry.includes(target))
            void runtime
              .deliverEvent(
                args.topic,
                { packageId, topic: args.topic, data },
                {
                  ...context,
                  callers: [
                    ...context.callers,
                    { packageId, permissionId: "" },
                  ],
                  ancestry: [...context.ancestry, target],
                },
              )
              .catch(() => {});
      return null;
    }
    case "mcpCheck": {
      if (current.manifest.kind !== "connector") denied();
      const tools = args.tools as McpTool[];
      const states = await s.core.checkMcpToolsV2(packageId, tools);
      s.mcpTools.set(
        packageId,
        states.map((state, i) => ({ tool: tools[i]!, state: state.state })),
      );
      hooks.event?.(s.record.instanceId, packageId, "mcp.updated", null);
      return states;
    }
    case "invoke": {
      const target = args.packageId as string;
      if (context.ancestry.includes(target) || context.ancestry.length >= 16)
        denied();
      if (!current.manifest.dependencies.some((d) => d.id === target)) denied();
      const kind = args.kind as ContributionKind,
        name = args.name as string;
      const runtime = await hooks.runtime(target);
      const invocation = {
        ...context,
        ancestry: [...context.ancestry, target],
      };
      const token = [...context.callers, { packageId, permissionId: "" }];
      invocation.callers = token;
      return runtime.invoke(kind, name, args.input, invocation);
    }
    case "capability": {
      const permissionId = args.permissionId as string;
      let request = args.request as CapabilityRequest;
      if (request.kind === "fs" && request.operation === "write")
        request = { ...request, data: new Uint8Array(request.data) };
      if (request.kind === "exec") denied();
      const callers: InvocationContext["callers"] = [];
      for (const c of context.callers) {
        const principal = (await s.core.getPackage(c.packageId)).manifest;
        if (!isManifestV2(principal)) denied();
        const target = current.manifest.permissions.find(
          (p) => p.id === permissionId,
        )?.target;
        const selected = principal.permissions.find(
          (p) =>
            p.kind === request.kind &&
            p.target === target &&
            (request.kind !== "fs" ||
              (p.kind === "fs" && p.operations.includes(request.operation))) &&
            (request.kind !== "service" ||
              (p.kind === "service" &&
                p.operations.includes(request.operation))),
        );
        if (!selected) denied();
        callers.push({ packageId: c.packageId, permissionId: selected.id });
      }
      const signal = AbortSignal.any([context.signal, s.controller.signal]);
      const mcpTool = args.mcpTool as McpTool | undefined;
      const secretValues = await hooks.secretValues();
      let tail = "";
      const maxSecret = Math.max(1, ...secretValues.map((s) => s.length));
      const chunk = (data: string, final = false) => {
        tail += data;
        let end = final
          ? tail.length
          : Math.max(0, tail.length - maxSecret + 1);
        for (const secret of secretValues.filter(Boolean)) {
          let at = tail.indexOf(secret);
          while (at >= 0) {
            if (at < end && at + secret.length > end) end = at;
            at = tail.indexOf(secret, at + 1);
          }
        }
        if (end) {
          hooks.event?.(
            s.record.instanceId,
            packageId,
            "io.chunk",
            redact(tail.slice(0, end), secretValues),
          );
          tail = tail.slice(end);
        }
      };
      return ioContext.run(
        {
          signal,
          packageId,
          permissionId,
          contribution: desktopContribution(current.manifest),
          secrets: s.secrets,
          onChunk: (data) => chunk(data),
        },
        async () => {
          const result = await s.core.runDelegatedCapability({
            packageId,
            permissionId,
            callers,
            request,
            signal,
            ...(mcpTool ? { mcpTool } : {}),
          });
          if (request.kind === "service" && result.kind === "service" && result.operation === "request" &&
            current.manifest.permissions.some(p => "kind" in p && p.id === permissionId && p.kind === "service" && p.target === "https")) {
            const status = (result.result as { status: number }).status;
            if (s.receipts.size >= 128) s.receipts.delete(s.receipts.keys().next().value!);
            s.receipts.set(result.callId, { packageId, invocationId: context.invocationId!, status });
          }
          chunk("", true);
          if (result.kind === "fs" && result.operation === "read")
            return { ...result, data: [...result.data] };
          return redact(result, secretValues);
        },
      );
    }
    default:
      return denied();
  }
}
