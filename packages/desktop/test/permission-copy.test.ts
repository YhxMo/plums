import { it, expect } from "vitest";
import { permissionCopy } from "../src/shared/permission-copy.js";
import { newerVersion } from "../src/shared/version.js";
it("renders permission semantics by manifest major and preserves unknown metadata", () => {
  const permission = {
    id: "files",
    target: "workspace",
    reason: "读取文件",
    level: "read" as const,
    kind: "fs",
    operations: ["write"],
  };
  expect(permissionCopy(permission, "1.0")).toBe("读取 workspace 的数据");
  expect(
    permissionCopy(
      {
        id: "files",
        target: "workspace",
        reason: "读写文件",
        kind: "fs",
        operations: ["read", "write"],
        level: "read",
      },
      "2.0",
    ),
  ).toBe("读取和写入目录 workspace 内的文件");
  expect(
    permissionCopy(
      { id: "site", target: "*.example.com", reason: "查询", kind: "egress" },
      "2.0",
    ),
  ).toBe("把数据发送到 example.com 这个网站的所有子站");
});
it("marks only newer semantic library versions, including prereleases", () => {
  expect(newerVersion("1.10.0", "1.9.9")).toBe(true);
  expect(newerVersion("2.0.0-beta.10", "2.0.0-beta.2")).toBe(true);
  expect(newerVersion("2.0.0", "2.0.0-rc.1")).toBe(true);
  expect(newerVersion("2.0.0-rc.1", "2.0.0")).toBe(false);
  expect(newerVersion("1.0.0+build", "1.0.0")).toBe(false);
});

it("names the configured model target without a provider whitelist", () => {
  const permission = {
    id: "model",
    kind: "service" as const,
    target: "model",
    operations: ["complete"],
    reason: "模型调用",
  };
  expect(permissionCopy(permission)).toBe("使用当前 Agent 配置的模型服务");
  expect(
    permissionCopy(permission, "2.0", ["opencode.ai（custom-model）"]),
  ).toBe("使用当前 Agent 配置的模型服务：opencode.ai（custom-model）");
});
