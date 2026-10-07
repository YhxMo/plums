import { rmSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import {
  MemorySecretStore,
  ScriptedConfirm,
  secretRef,
  type AuditEvent,
  type Core,
  type CreateCoreOptions,
  type RunCapabilityInput,
} from "@plums/core";
import {
  makeCore,
  validManifestV2,
  manifestZip,
  expectPlumsError,
} from "./package-helpers.js";
const worlds: { core: Core; dataDir: string }[] = [];
afterEach(() => {
  for (const w of worlds.splice(0)) {
    w.core.close();
    rmSync(w.dataDir, { recursive: true, force: true });
  }
});
async function setup(
  options: Partial<CreateCoreOptions> = {},
  effect: "read" | "external-write" | "model-egress" = "read",
) {
  const events: Readonly<AuditEvent>[] = [],
    calls: unknown[] = [];
  let active = true,
    fingerprint = "one";
  const w = makeCore({
    instanceId: "first",
    services: {
      mail: {
        ownerId: "provider",
        operations: { read: effect },
        getBinding: () =>
          active
            ? {
                fingerprint,
                sources: ["inbox"],
                ...(effect === "model-egress" ? { host: "model.example" } : {}),
              }
            : undefined,
        invoke: async (request) => {
          await request.assertActive();
          calls.push(request.input);
          return { value: "data" };
        },
      },
    },
    onAudit: (event) => {
      events.push(event);
    },
    ...options,
  });
  worlds.push(w);
  for (const [id, kind] of [
    ["provider", "connector"],
    ["caller", "extension"],
  ] as const) {
    const manifest = {
      ...validManifestV2(kind),
      id,
      permissions: [
        {
          id: "mail",
          kind: "service" as const,
          target: "mail",
          operations: ["read"],
          reason: "Read mail",
        },
      ],
    };
    await w.core.importPackage(await manifestZip(manifest));
    await w.core.grantConsent(id);
    await w.core.enable(id);
  }
  const grant = () =>
    w.core.grantBackgroundConsent({
      extensionId: "caller",
      permissionId: "mail",
      binding: "account",
      operation: "read",
      sources: ["inbox"],
    });
  const request: RunCapabilityInput = {
    extensionId: "caller",
    permissionId: "mail",
    request: {
      kind: "service",
      binding: "account",
      operation: "read",
      sources: ["inbox"],
      input: { n: 1 },
    },
  };
  return {
    ...w,
    calls,
    events,
    grant,
    request,
    change: () => {
      fingerprint = "two";
    },
    revoke: () => {
      active = false;
    },
  };
}
it("requires declaration, consent, source and binding grants; records no request data", async () => {
  const w = await setup();
  await expectPlumsError(w.core.runCapability(w.request), "CONSENT_REQUIRED");
  await w.grant();
  await expect(w.core.runCapability(w.request)).resolves.toMatchObject({
    kind: "service",
    result: { value: "data" },
  });
  expect(w.calls).toEqual([{ n: 1 }]);
  expect(JSON.stringify(w.events)).not.toContain("inbox");
  expect(JSON.stringify(w.events)).not.toContain('"n"');
  const request = {
    ...w.request,
    request: { ...w.request.request, sources: ["outside"] },
  };
  await expectPlumsError(
    w.core.runCapability(request as RunCapabilityInput),
    "PERMISSION_DENIED",
  );
  w.change();
  await expectPlumsError(w.core.runCapability(w.request), "CONSENT_REQUIRED");
  expect(w.calls).toHaveLength(1);
});
it("requires each external modification confirmation and refuses a background grant", async () => {
  const confirm = new ScriptedConfirm([true, false]);
  const w = await setup({ confirm }, "external-write");
  await expectPlumsError(w.grant(), "PERMISSION_DENIED");
  await w.core.runCapability(w.request);
  await expectPlumsError(
    w.core.runCapability(w.request),
    "CONFIRMATION_DENIED",
  );
  expect(w.calls).toHaveLength(1);
  expect(confirm.asked).toHaveLength(2);
});
it("missing audit never invokes a service", async () => {
  const w = await setup({ onAudit: undefined });
  await expectPlumsError(w.grant(), "CAPABILITY_FAILED");
  expect(w.calls).toEqual([]);
});
it.each(["revoke", "disable", "provider", "binding", "abort"] as const)(
  "blocks %s during asynchronous allow audit",
  async (action) => {
    let w: Awaited<ReturnType<typeof setup>>;
    const controller = new AbortController();
    w = await setup({
      onAudit: async (event) => {
        if (event.phase !== "allow") return;
        await Promise.resolve();
        if (action === "revoke")
          await w.core.revokeBackgroundConsent("caller", "account");
        if (action === "disable") await w.core.disable("caller");
        if (action === "provider") await w.core.disable("provider");
        if (action === "binding") w.change();
        if (action === "abort") controller.abort();
      },
    });
    await w.grant();
    await expect(
      w.core.runCapability({ ...w.request, signal: controller.signal }),
    ).rejects.toBeDefined();
    expect(w.calls).toEqual([]);
  },
);
it("does not publish a result revoked during result audit", async () => {
  let w: Awaited<ReturnType<typeof setup>>;
  w = await setup({
    onAudit: async (event) => {
      if (event.phase === "result")
        await w.core.revokeBackgroundConsent("caller", "account");
    },
  });
  await w.grant();
  await expect(w.core.runCapability(w.request)).rejects.toBeDefined();
  expect(w.calls).toHaveLength(1);
});
it("cannot restore a grant revoked while its grant audit waits", async () => {
  let w: Awaited<ReturnType<typeof setup>>;
  w = await setup({
    onAudit: async (event) => {
      if (event.phase === "grant")
        await w.core.revokeBackgroundConsent("caller", "account");
    },
  });
  await expect(w.grant()).rejects.toBeDefined();
  expect(await w.core.listBackgroundConsents()).toEqual([]);
});
it("copies requests before audit waits and never runs accessors", async () => {
  let w: Awaited<ReturnType<typeof setup>>;
  w = await setup({
    onAudit: (event) => {
      if (event.phase === "allow") (w.request.request as any).input.n = 99;
    },
  });
  await w.grant();
  await w.core.runCapability(w.request);
  expect(w.calls).toEqual([{ n: 1 }]);
  let read = false;
  const input = Object.defineProperty({}, "n", {
    get() {
      read = true;
      return 42;
    },
  });
  await expect(
    w.core.runCapability({
      ...w.request,
      request: { ...w.request.request, input },
    } as RunCapabilityInput),
  ).rejects.toBeDefined();
  expect(read).toBe(false);
});
it("returns only secret references in settings descriptions", async () => {
  const secrets = new MemorySecretStore(),
    w = await setup({ secrets });
  const manifest = {
    ...validManifestV2(),
    id: "settings",
    dependencies: [],
    settingsSchema: {
      type: "object" as const,
      properties: {
        token: {
          type: "string" as const,
          title: "Token",
          description: "Token",
          "x-secret": true,
        },
      },
    },
  };
  await w.core.importPackage(await manifestZip(manifest));
  const ref = secretRef("settings", "token");
  await secrets.set(ref, "private-token");
  await w.core.setSettings("settings", { token: ref });
  expect((await w.core.describeSettings("settings")).values).toEqual({});
});

it("previews background consent without audit or service execution, including stale bindings", async () => {
  const w = await setup();
  const input = {
    extensionId: "caller",
    permissionId: "mail",
    binding: "account",
    operation: "read",
    sources: ["inbox"],
  };
  expect(await w.core.hasBackgroundConsent(input)).toBe(false);
  expect(w.events).toHaveLength(0);
  await w.grant();
  const audited = w.events.length;
  expect(await w.core.hasBackgroundConsent(input)).toBe(true);
  expect(w.events).toHaveLength(audited);
  expect(w.calls).toHaveLength(0);
  w.change();
  expect(await w.core.hasBackgroundConsent(input)).toBe(false);
});

it("cannot restore pending consent across uninstall and reinstall", async () => {
  let w: Awaited<ReturnType<typeof setup>>;
  w = await setup({
    onAudit: async (event) => {
      if (event.phase !== "grant") return;
      const contents = await w.core.getPackageContents("caller");
      const bytes = await w.core.exportPackage(contents);
      await w.core.uninstall("caller");
      await w.core.importPackage(bytes);
      await w.core.grantConsent("caller");
      await w.core.enable("caller");
    },
  });
  await expect(w.grant()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(await w.core.listBackgroundConsents()).toEqual([]);
});

it("requires model egress confirmation outside a task and names the bound service host", async () => {
  const confirm = new ScriptedConfirm([true, false]);
  const w = await setup({ confirm }, "model-egress");
  await w.grant();
  expect(confirm.asked).toHaveLength(0);
  await w.core.runCapability(w.request);
  expect(confirm.asked[0]?.host).toBe("model.example");
  expect(confirm.asked[0]?.message).toContain("把数据发送到 model.example");
  await expectPlumsError(
    w.core.runCapability(w.request),
    "CONFIRMATION_DENIED",
  );
  expect(w.calls).toHaveLength(1);
});
