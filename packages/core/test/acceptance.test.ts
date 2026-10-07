import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FakeModelProvider,
  MemorySecretStore,
  mcpToolFingerprint,
  RecordingEgressSink,
  ScriptedConfirm,
  secretRef,
  type Confirm,
  type Core,
  type Manifest,
  type McpTool,
} from "@plums/core";
import { afterEach, describe, expect, it } from "vitest";
import { captureOutput, serializeError } from "./contract-helpers.js";
import {
  expectPlumsError,
  listAll,
  makeCore,
  manifestZip,
} from "./package-helpers.js";

/**
 * Public core contracts with synthetic packages, tool lists and downloads.
 * Leak checks include non-enumerable error properties and the whole cause chain.
 */

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "packages",
);
const fixture = (rel: string) => path.join(FIXTURES, rel);
const FAKE = "plums-fake-secret-9f3a7c1e-DO-NOT-USE";
const PERMS: Manifest["permissions"] = [
  { id: "search", level: "read", target: "notes", reason: "Search notes." },
  { id: "post", level: "write", target: "notes", reason: "Post notes." },
];

interface World {
  core: Core;
  dataDir: string;
  egress: RecordingEgressSink;
  confirm: ScriptedConfirm;
  secrets: MemorySecretStore;
  model: FakeModelProvider;
}

const open: World[] = [];
afterEach(() => {
  for (const w of open.splice(0)) {
    w.core.close();
    rmSync(w.dataDir, { recursive: true, force: true });
  }
});

function world(
  options: {
    answers?: boolean[];
    confirm?: Confirm;
    redirects?: Record<number, string>;
    body?: string;
  } = {},
): World {
  const egress = new RecordingEgressSink(
    options.redirects,
    options.body === undefined ? {} : { body: options.body },
  );
  const confirm = new ScriptedConfirm(
    options.answers ?? [true, true, true, true],
  );
  const model = new FakeModelProvider();
  const secrets = new MemorySecretStore();
  const made = makeCore({
    egress,
    confirm: options.confirm ?? confirm,
    secrets,
    model,
  });
  const w = { ...made, egress, confirm, secrets, model };
  open.push(w);
  return w;
}

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

/** Every file under dataDir, including `plums.db` and a `-wal` or `-journal` file when sqlite created one. */
function expectNoSecretOnDisk(dataDir: string): void {
  const files = listAll(dataDir).filter((name) =>
    statSync(path.join(dataDir, name)).isFile(),
  );
  expect(files).toContain("plums.db");
  for (const name of files) {
    expect(readFileSync(path.join(dataDir, name), "latin1")).not.toContain(
      FAKE,
    );
  }
}

describe("验收 1: 导入合法包，坏包带路径，导出再导入一致，已安装的不能再导入", () => {
  it("imports a valid package as installed, not enabled and not consented", async () => {
    const w = world();
    const imported = await w.core.importPackage(
      fixture("valid/extension-min.zip"),
    );
    expect(imported.manifest).toMatchObject({
      id: "test.ext.min",
      kind: "extension",
      version: "1.0.0",
    });
    expect(await w.core.listInstalled()).toMatchObject([
      { id: "test.ext.min", enabled: false, consented: false },
    ]);
    expect(await w.core.getConsent("test.ext.min")).toBeNull();
  });

  it("a bad manifest is MANIFEST_INVALID and names the missing field", async () => {
    const w = world();
    const err = await expectPlumsError(
      w.core.importPackage(fixture("invalid/missing-name.zip")),
      "MANIFEST_INVALID",
      "/name",
    );
    expect(err.path).toBe("/name");
    expect(listAll(w.dataDir)).toEqual([]);
    expect(await w.core.listInstalled()).toEqual([]);
  });

  it("export then import keeps the same manifest and files", async () => {
    const w = world();
    const first = await w.core.importPackage(
      fixture("valid/extension-unknown-fields.zip"),
    );
    const bytes = await w.core.exportPackage({
      manifest: first.manifest,
      files: first.files,
    });
    const again = await world().core.validatePackage(bytes);
    expect(again.manifest).toEqual(first.manifest);
    expect(again.files).toEqual(first.files);
    expect(again.manifest.futureField).toEqual({ a: 1 });
  });

  it("importing an id that is already installed is IMPORT_INVALID / ALREADY_INSTALLED", async () => {
    const w = world();
    const id = "test.ext.min";
    await w.core.importPackage(fixture("valid/extension-min.zip"));
    await w.core.grantConsent(id);
    await w.secrets.set(secretRef(id, "apiKey"), FAKE);
    await w.secrets.set("other/key", "stay");
    const data = path.join(w.dataDir, "data", id);
    mkdirSync(data, { recursive: true });
    writeFileSync(path.join(data, "settings.json"), '{"note":"keep"}');
    const err = await expectPlumsError(
      w.core.importPackage(fixture("valid/extension-min.zip")),
      "IMPORT_INVALID",
    );
    expect(err.details).toEqual({ id, reason: "ALREADY_INSTALLED" });
    expect(await w.core.listInstalled()).toMatchObject([
      { id, enabled: false, consented: true },
    ]);
    expect(readFileSync(path.join(data, "settings.json"), "utf8")).toBe(
      '{"note":"keep"}',
    );
    expect(await w.secrets.get(secretRef(id, "apiKey"))).toBe(FAKE);
    expect(await w.secrets.get("other/key")).toBe("stay");
  });
});

describe("验收 2: inspect 不安装就返回权限清单", () => {
  it("returns kind, id and the permissions in order, and writes nothing", async () => {
    const w = world();
    const summary = await w.core.inspect(
      fixture("valid/extension-3-levels.zip"),
    );
    expect(summary).toMatchObject({
      kind: "extension",
      id: "test.ext.perms",
      name: "test.ext.perms",
      version: "1.0.0",
    });
    expect(summary.permissions.map((p) => [p.id, p.level, p.reason])).toEqual([
      ["p.read", "read", "读取记忆"],
      ["p.write", "write", "写入笔记"],
      ["p.egress", "egress", "把摘要发给示例网站"],
    ]);
    expect(listAll(w.dataDir)).toEqual([]);
    expect(
      await w.core.inspect(
        readFileSync(fixture("valid/extension-3-levels.zip")),
      ),
    ).toEqual(summary);
    expect(listAll(w.dataDir)).toEqual([]);
    expect(await w.core.listInstalled()).toEqual([]);
  });
});

describe("验收 3: 没同意不能启用，同意后可以", () => {
  it("enable without consent is CONSENT_REQUIRED, and grantConsent then enable succeeds", async () => {
    const w = world();
    await w.core.importPackage(fixture("valid/extension-min.zip"));
    await expectPlumsError(w.core.enable("test.ext.min"), "CONSENT_REQUIRED");
    expect(await w.core.listInstalled()).toMatchObject([
      { enabled: false, consented: false },
    ]);
    const consent = await w.core.grantConsent("test.ext.min");
    expect(consent.packageId).toBe("test.ext.min");
    expect(await w.core.enable("test.ext.min")).toMatchObject({
      enabled: true,
      consented: true,
    });
    expect(await w.core.getConsent("test.ext.min")).toEqual(consent);
  });
});

describe("验收 4: 越权被拒，没确认就不外发", () => {
  const EXT = "valid/extension-3-levels.zip";
  const ID = "test.ext.perms";

  it("an action on a package that is not enabled is PERMISSION_DENIED and sends nothing", async () => {
    const w = world();
    await w.core.importPackage(fixture(EXT));
    await w.core.grantConsent(ID);
    const err = await expectPlumsError(
      w.core.runAction({ extensionId: ID, permissionId: "p.read" }),
      "PERMISSION_DENIED",
    );
    expect(err.details).toMatchObject({ id: ID, reason: "NOT_ENABLED" });
    expect(w.egress.records).toEqual([]);
  });

  it("a permission the extension did not declare is PERMISSION_DENIED at /permissions", async () => {
    const w = world();
    await w.core.importPackage(fixture(EXT));
    await w.core.grantConsent(ID);
    await w.core.enable(ID);
    const err = await expectPlumsError(
      w.core.runAction({
        extensionId: ID,
        permissionId: "p.other",
        request: { url: "https://example.com/x" },
      }),
      "PERMISSION_DENIED",
      "/permissions",
    );
    expect(err.details).toMatchObject({ id: ID, permissionId: "p.other" });
    expect([w.confirm.asked, w.egress.records]).toEqual([[], []]);
  });

  it("a refused confirm blocks the egress and the sink stays empty", async () => {
    const w = world({ answers: [false] });
    await w.core.importPackage(fixture(EXT));
    await w.core.grantConsent(ID);
    await w.core.enable(ID);
    const err = await expectPlumsError(
      w.core.runAction({
        extensionId: ID,
        permissionId: "p.egress",
        request: { url: "https://example.com/x" },
      }),
      "CONFIRMATION_DENIED",
    );
    expect(err.details).toMatchObject({ id: ID, permissionId: "p.egress" });
    expect(w.egress.records).toEqual([]);
    expect(w.model.calls).toEqual([]);
  });

  it("an allowed egress sends once, and confirm carries host and reason", async () => {
    const w = world({ answers: [true] });
    await w.core.importPackage(fixture(EXT));
    await w.core.grantConsent(ID);
    await w.core.enable(ID);
    const result = await w.core.runAction({
      extensionId: ID,
      permissionId: "p.egress",
      request: { url: "https://example.com/x" },
    });
    expect(result).toMatchObject({ level: "egress" });
    expect(w.confirm.asked).toEqual([
      expect.objectContaining({
        host: "example.com",
        reason: "把摘要发给示例网站",
      }),
    ]);
    expect(w.confirm.asked[0]?.message).not.toContain("https://");
    expect(w.egress.records).toEqual([{ url: "https://example.com/x" }]);
  });
});

describe("验收 5: 更新增权且未重新同意时，旧版保持", () => {
  it("refuses the new permission and leaves the installed version in place", async () => {
    const w = world();
    const id = "test.ext.update";
    await w.core.importPackage(fixture("valid/update/ext-v1.zip"));
    await w.core.grantConsent(id);
    await w.core.enable(id);
    const err = await expectPlumsError(
      w.core.updatePackage(fixture("valid/update/ext-v2-more-perms.zip")),
      "CONSENT_REQUIRED",
      "/permissions/1",
    );
    expect(err.details).toMatchObject({
      id,
      permissionId: "p.egress",
      reason: "NEW_PERMISSION",
    });
    expect(await w.core.listInstalled()).toMatchObject([
      { id, version: "1.0.0", enabled: true },
    ]);
    const onDisk = JSON.parse(
      readFileSync(
        path.join(w.dataDir, "packages", id, "manifest.json"),
        "utf8",
      ),
    ) as { version: string };
    expect(onDisk.version).toBe("1.0.0");
  });
});

describe("验收 6: 假密钥在报错、导出包和控制台输出里都搜不到", () => {
  const ID = "test.ext.secretref";
  const ref = secretRef(ID, "apiKey");

  const { lines } = captureOutput();

  it("stores the ref, and resolveSettings is the call that returns the value", async () => {
    const w = world();
    await w.core.importPackage(fixture("secret/package-with-secretref.zip"));
    await w.secrets.set(ref, FAKE);
    await w.core.setSettings(ID, { apiKey: ref });
    const saved = readFileSync(
      path.join(w.dataDir, "data", ID, "settings.json"),
      "utf8",
    );
    expect(saved).toContain(ref);
    expect(saved).not.toContain(FAKE);
    expect(await w.core.resolveSettings(ID)).toEqual({ apiKey: FAKE });
    expectNoSecretOnDisk(w.dataDir);
  });

  it("errors, the exported zip and console/stdout/stderr do not contain the fake secret", async () => {
    const w = world();
    await w.core.importPackage(fixture("secret/package-with-secretref.zip"));
    await w.secrets.set(ref, FAKE);
    const manifest = (
      await w.core.validatePackage(fixture("secret/package-with-secretref.zip"))
    ).manifest;

    const refused = await expectPlumsError(
      w.core.setSettings(ID, { apiKey: FAKE }),
      "SECRET_NOT_FOUND",
      "/settings/apiKey",
    );
    expect(serializeError(refused)).not.toContain(FAKE);

    const leaked = await expectPlumsError(
      w.core.exportPackage({
        manifest,
        files: { "notes.txt": `see ${FAKE}`, [`${FAKE}.txt`]: "x" },
      }),
      "IMPORT_INVALID",
    );
    expect(serializeError(leaked)).not.toContain(FAKE);

    const bytes = await w.core.exportPackage({
      manifest,
      files: { "notes.txt": "hello", "dir/a.txt": "world" },
    });
    expect(latin1(bytes)).not.toContain(FAKE);
    const unpacked = await w.core.validatePackage(bytes);
    for (const name of ["manifest.json", ...Object.keys(unpacked.files)])
      expect(name).not.toContain(FAKE);
    for (const data of Object.values(unpacked.files))
      expect(latin1(data)).not.toContain(FAKE);
    expect(JSON.stringify(unpacked.manifest)).not.toContain(FAKE);

    await w.core.setSettings(ID, { apiKey: ref });
    await w.core.resolveSettings(ID);
    expect(lines.join("\n")).not.toContain(FAKE);
    expectNoSecretOnDisk(w.dataDir);
  });
});

describe("验收 7: 卸载后数据、同意和密钥都清除，同一个 id 可以重新安装", () => {
  it("removes the package, its consent and its secret, then imports it as a new install", async () => {
    const w = world();
    const id = "test.ext.secretref";
    const ref = secretRef(id, "apiKey");
    await w.core.importPackage(fixture("secret/package-with-secretref.zip"));
    await w.secrets.set(ref, FAKE);
    await w.core.grantConsent(id);
    await w.core.setSettings(id, { apiKey: ref });
    await w.core.uninstall(id);

    expect(
      listAll(w.dataDir).some(
        (name) =>
          name.startsWith(`packages/${id}`) || name.startsWith(`data/${id}`),
      ),
    ).toBe(false);
    expect(await w.secrets.get(ref)).toBeUndefined();
    expect(await w.core.listInstalled()).toEqual([]);
    await expectPlumsError(w.core.getConsent(id), "PERMISSION_DENIED");

    await w.core.importPackage(fixture("secret/package-with-secretref.zip"));
    expect(await w.core.listInstalled()).toMatchObject([
      { id, enabled: false, consented: false },
    ]);
    expect(await w.core.getConsent(id)).toBeNull();
    await expectPlumsError(w.core.enable(id), "CONSENT_REQUIRED");
    await expectPlumsError(
      w.core.setSettings(id, { apiKey: ref }),
      "SECRET_NOT_FOUND",
    );
  });
});

describe("验收 8: 文件和链接分享得到同一个未启用的包，失败的链接不留下文件", () => {
  it("shareToFile and importFromUrl produce the same manifest and files", async () => {
    const source = world();
    const first = await source.core.importPackage(
      fixture("valid/character-min.zip"),
    );
    const file = path.join(source.dataDir, "shared.zip");
    const bytes = await source.core.shareToFile(first.manifest.id, file);
    expect(latin1(readFileSync(file))).toBe(latin1(bytes));

    const byFile = await world().core.importPackage(file);
    const byLink = world({ answers: [true], body: latin1(bytes) });
    const linked = await byLink.core.importFromUrl(
      "https://share.example/pkg.zip?token=sekret#frag",
    );

    expect(linked.manifest).toEqual(byFile.manifest);
    expect(linked.files).toEqual(byFile.files);
    expect(await byLink.core.listInstalled()).toMatchObject([
      { id: first.manifest.id, enabled: false, consented: false },
    ]);
    expect(byLink.confirm.asked).toEqual([
      expect.objectContaining({
        host: "share.example",
        reason: "下载别人分享的包",
      }),
    ]);
    expect(byLink.confirm.asked[0]?.message).not.toContain("pkg.zip");
    expect(byLink.egress.records).toEqual([
      { url: "https://share.example/pkg.zip?token=sekret#frag", method: "GET" },
    ]);
  });

  it("a link that fails keeps scheme, host, port and path, and drops the fragment", async () => {
    const w = world({ answers: [true], body: "<html>nope</html>" });
    const err = await expectPlumsError(
      w.core.importFromUrl(
        "https://Share.Example:8443/pkg.zip?token=sekret#frag",
      ),
      "SHARE_FETCH_FAILED",
      "/url",
    );
    expect(err.details).toEqual({
      url: "https://share.example:8443/pkg.zip",
      reason: "NOT_A_ZIP",
    });
    expect(String((err.details as { url: string }).url)).not.toContain("#frag");
    expect(w.egress.records).toEqual([
      {
        url: "https://share.example:8443/pkg.zip?token=sekret#frag",
        method: "GET",
      },
    ]);
    expect(serializeError(err)).not.toContain("sekret");
    expect(listAll(w.dataDir)).toEqual([]);

    const hidden = world({ answers: [true], body: "PK\x03\x04" });
    const denied = await expectPlumsError(
      hidden.core.importFromUrl(
        "https://User:pw@Share.Example/pkg.zip?token=sekret#frag",
      ),
      "SHARE_FETCH_FAILED",
      "/url",
    );
    expect(denied.details).toEqual({
      url: "https://share.example/pkg.zip",
      reason: "USERINFO",
    });
    expect(hidden.egress.records).toEqual([]);
    expect(serializeError(denied)).not.toContain("sekret");
    expect(serializeError(denied)).not.toContain("pw");
  });

  it("a byte after PK\\x03\\x04 widened by 0x100 is NOT_A_ZIP and is not truncated into the zip", async () => {
    const zip = latin1(readFileSync(fixture("valid/character-min.zip")));
    expect(zip.startsWith("PK\x03\x04")).toBe(true);
    const at = 4;
    const widened = `${zip.slice(0, at)}${String.fromCharCode(zip.charCodeAt(at) + 0x100)}${zip.slice(at + 1)}`;
    expect(widened.startsWith("PK\x03\x04")).toBe(true);
    expect(widened.charCodeAt(at) & 0xff).toBe(zip.charCodeAt(at));
    const w = world({ answers: [true], body: widened });
    const err = await expectPlumsError(
      w.core.importFromUrl("https://share.example/pkg.zip?token=sekret#frag"),
      "SHARE_FETCH_FAILED",
      "/url",
    );
    expect(err.details).toEqual({
      url: "https://share.example/pkg.zip",
      reason: "NOT_A_ZIP",
    });
    expect(String((err.details as { url: string }).url)).not.toContain("#frag");
    expect(w.egress.records).toEqual([
      { url: "https://share.example/pkg.zip?token=sekret#frag", method: "GET" },
    ]);
    expect(listAll(w.dataDir)).toEqual([]);
    expect(await w.core.listInstalled()).toEqual([]);
  });
});

describe("验收 9: 工具描述或 inputSchema 变了必须重新同意", () => {
  const MANUAL = "manual:notes";

  async function connector(w: World): Promise<void> {
    const base = (
      await w.core.validatePackage(fixture("valid/connector-min.zip"))
    ).manifest;
    await w.core.importPackage(
      await manifestZip({ ...base, permissions: PERMS }),
    );
    await w.core.grantConsent(base.id);
    await w.core.enable(base.id);
  }

  it("enable does not record a fingerprint; a changed description or schema needs approveMcpTools again", async () => {
    const w = world({ answers: [true] });
    await connector(w);
    const id = "test.conn.min";
    expect((await w.core.getMcpApprovals(id)).tools).toEqual([]);

    const tool: McpTool = {
      name: "search",
      description: "Search notes.",
      inputSchema: { type: "object", properties: { q: { type: "string" } } },
    };
    await expectPlumsError(
      w.core.authorizeMcpTool(id, tool),
      "CONSENT_REQUIRED",
      "/tools/search",
    );
    await w.core.approveMcpTools(id, [tool]);
    expect(await w.core.authorizeMcpTool(id, tool)).toEqual({ level: "read" });

    const described = { ...tool, description: "Search notes!" };
    const schemaChanged = {
      ...tool,
      inputSchema: { type: "object", properties: { q: { type: "number" } } },
    };
    for (const next of [described, schemaChanged]) {
      expect(mcpToolFingerprint(next)).not.toBe(mcpToolFingerprint(tool));
      const err = await expectPlumsError(
        w.core.authorizeMcpTool(id, next),
        "CONSENT_REQUIRED",
        "/tools/search",
      );
      expect(err.details).toMatchObject({
        id,
        tool: "search",
        reason: "TOOL_CHANGED",
        fingerprint: mcpToolFingerprint(next),
      });
      expect(serializeError(err)).not.toContain("Search notes");
    }
    await w.core.approveMcpTools(id, [schemaChanged]);
    expect(await w.core.authorizeMcpTool(id, schemaChanged)).toEqual({
      level: "read",
    });
  });

  it("a tool that leaves the list must be approved again, and a bad list does not clear consent", async () => {
    const w = world({ answers: [true] });
    await connector(w);
    const id = "test.conn.min";
    const tool: McpTool = { name: "search", description: "Search notes." };
    const other: McpTool = {
      name: "post",
      description: "Post notes.",
      level: "write",
    };
    await w.core.approveMcpTools(id, [tool, other]);
    await w.core.approveMcpTools(MANUAL, [{ ...tool, level: "read" }]);
    const consent = await w.core.getConsent(id);

    expect(await w.core.checkMcpTools(id, [tool])).toEqual([
      {
        tool: "search",
        fingerprint: mcpToolFingerprint(tool),
        state: "APPROVED",
      },
    ]);
    const dropped = await expectPlumsError(
      w.core.authorizeMcpTool(id, other),
      "CONSENT_REQUIRED",
      "/tools/post",
    );
    expect(dropped.details).toMatchObject({
      id,
      tool: "post",
      reason: "TOOL_ADDED",
      fingerprint: mcpToolFingerprint(other),
    });
    expect(dropped.details).not.toHaveProperty("approvedFingerprint");

    expect(await w.core.checkMcpTools(id, [])).toEqual([]);
    expect((await w.core.getMcpApprovals(id)).tools).toEqual([]);
    expect(await w.core.getConsent(id)).toEqual(consent);
    expect((await w.core.getMcpApprovals(MANUAL)).tools).toHaveLength(1);
    const again = await expectPlumsError(
      w.core.authorizeMcpTool(id, tool),
      "CONSENT_REQUIRED",
      "/tools/search",
    );
    expect(again.details).toMatchObject({
      id,
      tool: "search",
      reason: "TOOL_ADDED",
    });

    await w.core.approveMcpTools(id, [tool]);
    await expect(
      w.core.checkMcpTools(id, [{ ...tool, inputSchema: Number.NaN }]),
    ).rejects.toThrow(TypeError);
    expect((await w.core.getMcpApprovals(id)).tools.map((t) => t.tool)).toEqual(
      ["search"],
    );
    expect(await w.core.authorizeMcpTool(id, tool)).toEqual({ level: "read" });
  });

  it("an unverified write is PERMISSION_DENIED / UNVERIFIED_READ_ONLY and is not stored", async () => {
    const w = world();
    const tool: McpTool = {
      name: "post",
      description: "Post a note.",
      level: "write",
    };
    const err = await expectPlumsError(
      w.core.authorizeMcpTool(MANUAL, tool),
      "PERMISSION_DENIED",
      "/tools/post",
    );
    expect(err.details).toEqual({
      id: MANUAL,
      tool: "post",
      reason: "UNVERIFIED_READ_ONLY",
    });
    expect((await w.core.getMcpApprovals(MANUAL)).tools).toEqual([]);
    expect((await w.core.approveMcpTools(MANUAL, [tool])).skipped).toEqual([
      { tool: "post", reason: "UNVERIFIED_READ_ONLY" },
    ]);
  });

  it("uninstall clears the connector fingerprints and a hand-added server's approvals", async () => {
    const w = world();
    await connector(w);
    const id = "test.conn.min";
    const tool: McpTool = { name: "search", description: "Search notes." };
    await w.core.approveMcpTools(id, [tool]);
    await w.core.approveMcpTools(MANUAL, [{ ...tool, level: "read" }]);

    await w.core.uninstall(id);
    await expectPlumsError(w.core.getMcpApprovals(id), "PERMISSION_DENIED");
    expect((await w.core.getMcpApprovals(MANUAL)).tools).toHaveLength(1);

    await w.core.uninstall(MANUAL);
    expect((await w.core.getMcpApprovals(MANUAL)).tools).toEqual([]);
    await expectPlumsError(
      w.core.authorizeMcpTool(MANUAL, { ...tool, level: "read" }),
      "CONSENT_REQUIRED",
      "/tools/search",
    );
  });
});

describe("验收 10: 外发目标只匹配声明的主机，通配符只匹配子域", () => {
  async function armed(rel: string, answers: boolean[] = [true]) {
    const w = world({ answers });
    const imported = await w.core.importPackage(fixture(rel));
    await w.core.grantConsent(imported.manifest.id);
    await w.core.enable(imported.manifest.id);
    return { w, id: imported.manifest.id };
  }

  it("api.example.com allows that host, including a path, and rejects a lookalike", async () => {
    const { w, id } = await armed("valid/egress-target-exact.zip");
    await w.core.runAction({
      extensionId: id,
      permissionId: "p.egress",
      request: { url: "https://api.example.com/x" },
    });
    expect(w.confirm.asked[0]).toMatchObject({
      host: "api.example.com",
      reason: "精确主机",
    });
    expect(w.egress.records.map((r) => r.url)).toEqual([
      "https://api.example.com/x",
    ]);

    const denied = world({ answers: [true] });
    const again = await denied.core.importPackage(
      fixture("valid/egress-target-exact.zip"),
    );
    await denied.core.grantConsent(again.manifest.id);
    await denied.core.enable(again.manifest.id);
    await expectPlumsError(
      denied.core.runAction({
        extensionId: again.manifest.id,
        permissionId: "p.egress",
        request: { url: "https://api.example.com.evil.com/x" },
      }),
      "PERMISSION_DENIED",
      "/request/url",
    );
    expect([denied.confirm.asked, denied.egress.records]).toEqual([[], []]);
  });

  it("*.example.com matches a subdomain and not the bare domain", async () => {
    const ok = await armed("valid/egress-target-wildcard.zip");
    await ok.w.core.runAction({
      extensionId: ok.id,
      permissionId: "p.egress",
      request: { url: "https://a.b.example.com/x" },
    });
    expect(ok.w.egress.records.map((r) => r.url)).toEqual([
      "https://a.b.example.com/x",
    ]);

    const bare = await armed("valid/egress-target-wildcard.zip");
    await expectPlumsError(
      bare.w.core.runAction({
        extensionId: bare.id,
        permissionId: "p.egress",
        request: { url: "https://example.com/x" },
      }),
      "PERMISSION_DENIED",
      "/request/url",
    );
    expect(bare.w.egress.records).toEqual([]);
  });

  it("a declared port is the only port that is allowed", async () => {
    const { w, id } = await armed("valid/egress-target-port.zip");
    await w.core.runAction({
      extensionId: id,
      permissionId: "p.egress",
      request: { url: "https://api.example.com:8443/x" },
    });
    expect(w.confirm.asked[0]).toMatchObject({ host: "api.example.com:8443" });
    expect(w.egress.records.map((r) => r.url)).toEqual([
      "https://api.example.com:8443/x",
    ]);
  });

  it("localhost, a trailing-dot host, an IP, http, the wrong port, and userinfo are URL_NOT_ALLOWED before confirm", async () => {
    const urls = [
      "https://localhost",
      "https://api.example.com./x",
      "https://1.2.3.4",
      "http://api.example.com",
      "https://api.example.com:8443",
      "https://user@api.example.com",
    ];
    for (const url of urls) {
      const { w, id } = await armed("valid/egress-target-exact.zip", [true]);
      const err = await expectPlumsError(
        w.core.runAction({
          extensionId: id,
          permissionId: "p.egress",
          request: { url },
        }),
        "PERMISSION_DENIED",
        "/request/url",
      );
      expect(err.details).toEqual({
        id,
        permissionId: "p.egress",
        reason: "URL_NOT_ALLOWED",
      });
      expect(w.confirm.asked).toEqual([]);
      expect(w.egress.records).toEqual([]);
    }
  });
});

describe("验收 11: localhost 不能当外发目标，也不能当分享链接的主机", () => {
  it("localhost, *.localhost and a localhost subdomain are MANIFEST_INVALID", async () => {
    const w = world();
    await expectPlumsError(
      w.core.importPackage(fixture("invalid/egress-target-localhost.zip")),
      "MANIFEST_INVALID",
      "/permissions/0/target",
    );
    const manifest = (
      await w.core.validatePackage(fixture("valid/egress-target-exact.zip"))
    ).manifest;
    for (const target of [
      "*.localhost",
      "api.localhost",
      "localhost.",
      "LocalHost",
      "API.LocalHost",
    ]) {
      manifest.permissions = [
        { id: "p.egress", level: "egress", target, reason: "no" },
      ];
      const err = await expectPlumsError(
        w.core.importPackage(await manifestZip(manifest)),
        "MANIFEST_INVALID",
        "/permissions/0/target",
      );
      if (target.endsWith(".")) {
        expect(err.details).toMatchObject({ reason: "TRAILING_DOT" });
        expect(err.message).toContain("主机名不能以点结尾");
      }
    }
    expect(await w.core.listInstalled()).toEqual([]);
  });

  it("localhost is LOCALHOST, and a trailing dot is TRAILING_DOT, both before confirm", async () => {
    for (const url of [
      "https://localhost/pkg.zip?token=sekret",
      "https://a.localhost/pkg.zip?token=sekret#frag",
      "https://localhost./x",
      "https://a.localhost./pkg.zip#frag",
      "https://share.example.:8443/p.zip?x=1#frag",
      "https://LocalHost/x",
      "https://LOCALHOST./pkg.zip?token=sekret",
    ]) {
      const w = world({ answers: [true], body: "PK\x03\x04" });
      const err = await expectPlumsError(
        w.core.importFromUrl(url),
        "SHARE_FETCH_FAILED",
        "/url",
      );
      const parsed = new URL(url);
      parsed.username = "";
      parsed.password = "";
      parsed.search = "";
      parsed.hash = "";
      const dotted = parsed.hostname.endsWith(".");
      expect(err.details).toEqual({
        url: parsed.href,
        reason: dotted ? "TRAILING_DOT" : "LOCALHOST",
      });
      expect(String((err.details as { url: string }).url)).not.toContain(
        "#frag",
      );
      if (dotted) expect(err.message).toContain("主机名不能以点结尾");
      expect([w.confirm.asked, w.egress.records]).toEqual([[], []]);
      expect(listAll(w.dataDir)).toEqual([]);
    }
  });
});

describe("验收 12: 内核不跟随重定向", () => {
  it("runAction returns redirectTo after exactly one send", async () => {
    const w = world({
      answers: [true],
      redirects: { 1: "https://evil.com/x" },
    });
    const imported = await w.core.importPackage(
      fixture("valid/egress-target-exact.zip"),
    );
    await w.core.grantConsent(imported.manifest.id);
    await w.core.enable(imported.manifest.id);
    const result = await w.core.runAction({
      extensionId: imported.manifest.id,
      permissionId: "p.egress",
      request: { url: "https://api.example.com/start" },
    });
    expect(result).toEqual({
      level: "egress",
      egress: { status: 302, body: "", redirectTo: "https://evil.com/x" },
    });
    expect(w.egress.records.map((r) => r.url)).toEqual([
      "https://api.example.com/start",
    ]);
  });

  it("a share link that redirects is SHARE_FETCH_FAILED and is not requested again", async () => {
    const w = world({
      answers: [true],
      redirects: { 1: "https://evil.com/pkg.zip?token=sekret" },
      body: "ignored",
    });
    const err = await expectPlumsError(
      w.core.importFromUrl("https://share.example/pkg.zip"),
      "SHARE_FETCH_FAILED",
      "/url",
    );
    expect(err.details).toEqual({
      url: "https://share.example/pkg.zip",
      reason: "REDIRECT",
    });
    expect(w.egress.records).toEqual([
      { url: "https://share.example/pkg.zip", method: "GET" },
    ]);
    expect(listAll(w.dataDir)).toEqual([]);
    expect(await w.core.listInstalled()).toEqual([]);
  });
});
