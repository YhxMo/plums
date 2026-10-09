import { rmSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import {
  RecordingEgressSink,
  type Core,
  type CreateCoreOptions,
  type RunDelegatedCapabilityInput,
  type ManifestV2,
  type ServicePermission,
} from "../src/index.js";
import { makeCore, manifestZip, validManifestV2 } from "./package-helpers.js";

const worlds: { core: Core; dataDir: string }[] = [];
afterEach(() => {
  for (const w of worlds.splice(0)) {
    w.core.close();
    rmSync(w.dataDir, { recursive: true, force: true });
  }
});
const permission: ServicePermission = {
  id: "api",
  kind: "service",
  target: "https",
  operations: ["request"],
  reason: "Synthetic remote service",
};
const tool = {
  name: "echo",
  description: "Synthetic echo",
  inputSchema: { type: "object", properties: { text: { type: "string" } } },
};
const manifest = (
  id: string,
  permissions = [permission],
  kind: "connector" | "extension" = "connector",
): ManifestV2 => ({
  ...validManifestV2(kind),
  id,
  permissions,
  payload: {},
});
async function setup(options: Partial<CreateCoreOptions> = {}) {
  const calls: unknown[] = [],
    egress = new RecordingEgressSink();
  const w = makeCore({
    egress,
    confirm: { ask: async () => true },
    onAudit: async () => {},
    services: {
      https: {
        operations: { request: "egress" },
        getBinding: () => ({
          fingerprint: "binding",
          host: "mcp.plums-fixture.test",
          sources: [],
        }),
        invoke: async (request) => {
          await request.assertActive();
          calls.push(request.input);
          return { synthetic: true };
        },
      },
    },
    ...options,
  });
  worlds.push(w);
  const install = async (m: ManifestV2) => {
    await w.core.importPackage(await manifestZip(m));
    await w.core.grantConsent(m.id);
    await w.core.enable(m.id);
  };
  const request: RunDelegatedCapabilityInput = {
    packageId: "bridge",
    permissionId: "api",
    callers: [],
    mcpTool: tool,
    request: {
      kind: "service",
      operation: "request",
      binding: "bridge/mcp",
      sources: [],
      input: { text: "original" },
    },
  };
  const grant = (id: string) =>
    w.core.grantBackgroundConsent({
      extensionId: id,
      permissionId: "api",
      binding: "bridge/mcp",
      operation: "request",
      sources: [],
    });
  await install(manifest("bridge"));
  await grant("bridge");
  return {
    ...w,
    calls,
    egress,
    install,
    grant,
    request,
    approve: () => w.core.approveMcpToolsV2("bridge", "api", [tool]),
    call: (input = request) => w.core.runDelegatedCapability(input),
  };
}

it("approves HTTPS service tools through the transport-neutral API and retains the caller intersection", async () => {
  const w = await setup();
  await w.call({ ...w.request, mcpTool: undefined });
  await expect(w.call()).rejects.toMatchObject({
    code: "CONSENT_REQUIRED",
    details: { reason: "TOOL_ADDED" },
  });
  expect(w.calls).toHaveLength(1);
  const rows = await w.approve();
  expect(Object.keys(rows[0]!).sort()).toEqual([
    "approvedAt",
    "fingerprint",
    "permissionId",
    "tool",
  ]);
  await w.call();
  await w.install(manifest("caller", [permission], "extension"));
  await w.grant("caller");
  await w.call({
    ...w.request,
    callers: [{ packageId: "caller", permissionId: "api" }],
  });
  expect(w.calls).toHaveLength(3);
  await w.install(manifest("unprivileged", [], "extension"));
  await expect(
    w.call({
      ...w.request,
      callers: [{ packageId: "unprivileged", permissionId: "api" }],
    }),
  ).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
    details: { reason: "PERMISSION_NOT_DECLARED" },
  });
  expect(w.calls).toHaveLength(3);
});

it.each(["description", "inputSchema", "removed"])(
  "requires new approval for %s",
  async (change) => {
    const w = await setup();
    await w.approve();
    const changed =
      change === "description"
        ? { ...tool, description: "Changed" }
        : {
            ...tool,
            inputSchema: {
              type: "object",
              properties: { text: { type: "number" } },
            },
          };
    if (change === "removed") {
      await w.core.checkMcpToolsV2("bridge", []);
      expect(await w.core.getMcpApprovalsV2("bridge")).toEqual([]);
    }
    await expect(
      w.call({ ...w.request, mcpTool: change === "removed" ? tool : changed }),
    ).rejects.toMatchObject({
      code: "CONSENT_REQUIRED",
      details: { reason: change === "removed" ? "TOOL_ADDED" : "TOOL_CHANGED" },
    });
    expect(w.calls).toEqual([]);
  },
);

it.each(["confirmation", "allow"])(
  "rechecks approval after asynchronous %s",
  async (phase) => {
    let w: Awaited<ReturnType<typeof setup>>;
    w = await setup({
      confirm: {
        ask: async () => {
          if (phase === "confirmation")
            await w.core.checkMcpToolsV2("bridge", []);
          return true;
        },
      },
      onAudit: async (event) => {
        if (phase === "allow" && event.phase === "allow") {
          await Promise.resolve();
          await w.core.checkMcpToolsV2("bridge", []);
        }
      },
    });
    await w.approve();
    await expect(w.call()).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    expect(w.calls).toEqual([]);
  },
);

it("copies the tool and request before confirmation", async () => {
  const copied = structuredClone(tool);
  let w: Awaited<ReturnType<typeof setup>>;
  w = await setup({
    confirm: {
      ask: async () => {
        copied.description = "Changed";
        copied.inputSchema.properties.text.type = "number";
        if (w.request.request.kind === "service")
          w.request.request.input = { text: "changed" };
        return true;
      },
    },
  });
  await w.approve();
  await w.call({ ...w.request, mcpTool: copied });
  expect(w.calls).toEqual([{ text: "original" }]);
});

it.each(["disabled", "other-target", "no-request", "extension", "wrong-id"])(
  "refuses MCP authority for %s",
  async (variant) => {
    const w = await setup();
    let id = "bridge";
    if (variant === "disabled") await w.core.disable(id);
    else if (variant === "wrong-id") {
      /* A different permission id must not inherit authority. */
    } else {
      id = "other";
      await w.install(
        manifest(
          id,
          [
            {
              ...permission,
              ...(variant === "other-target" ? { target: "mail" } : {}),
              ...(variant === "no-request" ? { operations: ["read"] } : {}),
            },
          ],
          variant === "extension" ? "extension" : "connector",
        ),
      );
    }
    await expect(
      w.core.approveMcpToolsV2(id, variant === "wrong-id" ? "other" : "api", [
        tool,
      ]),
    ).rejects.toBeDefined();
    expect(w.calls).toEqual([]);
  },
);

it("keeps service-operation consent and the legacy egress route", async () => {
  const w = await setup();
  const original = await w.core.getPackage("bridge");
  await expect(
    w.core.updatePackage(
      await manifestZip({
        ...original.manifest,
        version: "3.0.0",
        permissions: [{ ...permission, operations: ["request", "read"] }],
      }),
    ),
  ).rejects.toMatchObject({
    code: "CONSENT_REQUIRED",
    details: { reason: "SERVICE_OPERATIONS_CHANGED" },
  });
  expect((await w.core.getPackage("bridge")).manifest.version).toBe(
    original.manifest.version,
  );
  await w.approve();
  await w.call();
  const legacy: ManifestV2 = {
    ...manifest("legacy"),
    permissions: [
      {
        id: "send",
        kind: "egress",
        target: "mcp.plums-fixture.test",
        reason: "Legacy transport",
      },
    ],
  };
  await w.install(legacy);
  await w.core.approveMcpToolsV2("legacy", "send", [tool]);
  await w.core.runDelegatedCapability({
    packageId: "legacy",
    permissionId: "send",
    callers: [],
    request: { kind: "egress", url: "https://mcp.plums-fixture.test" },
    mcpTool: tool,
  });
  expect(w.egress.records).toHaveLength(1);
});
