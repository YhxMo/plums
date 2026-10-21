import { describe, expect, it } from "vitest";
import { Host } from "../modules/extension-host/host";
import { diagnoseLayoutFallback } from "../modules/shell/diagnostics";
import type { Platform } from "../modules/sdk";
import { errorMessage } from "../src/shell/messages";

const createPlatform = (): Platform => ({
  kind: "browser",
  available: () => true,
  grant: async () => {},
  call: async () => null,
});

const catalog: import("../modules/shell/uninstall").ImportedExtension[] = [
  { id: "transform.upper", url: "/services/upper.js", label: "大写转换服务" },
  { id: "workbench", url: "/services/workbench.js", label: "文本工作台" },
  {
    id: "ui.default",
    url: "/ui/default.js",
    label: "默认工作台布局",
    views: { default: "工作台" },
  },
  { id: "agents.local", url: "内置公开服务", label: "Agent 核心" },
  {
    id: "ui.agents",
    url: "内置可替换界面",
    label: "默认 Agent 界面",
    views: { agents: "Agent 界面" },
  },
];

describe("diagnoseLayoutFallback", () => {
  it.each([
    { label: "default diagnostics", describe: undefined },
    { label: "shell formatting", describe: errorMessage },
  ])(
    "explains disabled vs waiting for permission with $label",
    async ({ describe }) => {
      const host = new Host(createPlatform(), undefined, describe);
      host.install({
        manifest: {
          id: "transform.upper",
          version: "1.0.0",
          apiVersion: 1,
          provides: { "text.transform": 1 },
        },
        activate(ctx) {
          ctx.provide("text.transform", 1, { name: "Upper" });
        },
      });
      host.install({
        manifest: {
          id: "workbench",
          version: "1.0.0",
          apiVersion: 1,
          requires: { "text.transform": 1 },
          provides: { workbench: 1 },
          capabilities: ["state.read", "state.write"],
        },
        activate(ctx) {
          ctx.provide("workbench", 1, {});
        },
      });
      host.install({
        manifest: {
          id: "ui.default",
          version: "1.0.0",
          apiVersion: 1,
          requires: { workbench: 1 },
        },
        activate(ctx) {
          ctx.view({
            id: "default",
            label: "工作台",
            mount: () => () => {},
          });
        },
      });
      host.install({
        manifest: {
          id: "ui.agents",
          version: "0.0.4",
          apiVersion: 1,
        },
        activate(ctx) {
          ctx.view({
            id: "agents",
            label: "Agent 界面",
            priority: 100,
            mount: () => () => {},
          });
        },
      });
      await host.start("transform.upper");
      await host.start("ui.agents");

      const disabledDiag = diagnoseLayoutFallback(
        host,
        catalog,
        "default",
        "agents",
        {},
        {},
      );
      expect(disabledDiag?.targetExtensionId).toBe("ui.default");
      expect(disabledDiag?.message).toContain("工作台 (default)");
      expect(disabledDiag?.message).toContain("尚未启用");
      expect(disabledDiag?.message).toContain("已切换至 Agent 界面");

      await host.start("workbench");
      await host.start("ui.default");
      const permissionDiag = diagnoseLayoutFallback(
        host,
        catalog,
        "default",
        "agents",
        {},
        {},
      );
      expect(permissionDiag?.targetExtensionId).toBe("workbench");
      expect(permissionDiag?.message).toContain("等待「读取隔离状态」授权");
      expect(permissionDiag?.signature).not.toBe(disabledDiag?.signature);
    },
  );
});

it("uses catalog view hints for an unknown disabled UI", () => {
  const host = new Host(createPlatform());
  host.install({
    manifest: { id: "independent.ui", apiVersion: 1, version: "1" },
    activate() {},
  });
  const result = diagnoseLayoutFallback(
    host,
    [
      {
        id: "independent.ui",
        label: "独立界面",
        url: "/independent.js",
        views: { "notes-grid": "笔记网格" },
      },
    ],
    "notes-grid",
    undefined,
    {},
    {},
  );
  expect(result).toMatchObject({
    label: "笔记网格",
    targetExtensionId: "independent.ui",
  });
  expect(result?.message).toContain("尚未启用");
});

it.each(["constructor", "toString"])(
  "uses only own string view hints and failures for %s",
  (viewId) => {
    const host = new Host(createPlatform());
    host.install({
      manifest: { id: "notes.ui", apiVersion: 1, version: "1" },
      activate() {},
    });
    const catalog: import("../modules/shell/uninstall").ImportedExtension[] = [
      {
        id: "first.ui",
        url: "/first.js",
        label: "First",
        views: { default: "Default" },
      },
      {
        id: "invalid.ui",
        url: "/invalid.js",
        label: "Invalid",
        views: { [viewId]: 42 as unknown as string },
      },
      {
        id: "notes.ui",
        url: "/notes.js",
        label: "Notes",
        views: { [viewId]: "Notes grid" },
      },
    ];
    const disabled = diagnoseLayoutFallback(
      host,
      catalog,
      viewId,
      undefined,
      {},
      {},
    );
    expect(disabled).toMatchObject({
      label: "Notes grid",
      targetExtensionId: "notes.ui",
    });
    expect(disabled?.reason).toContain("尚未启用");
    expect(disabled?.reason).not.toContain("模块加载失败");
    const active = diagnoseLayoutFallback(
      host,
      catalog,
      "missing",
      viewId,
      {},
      {},
    );
    expect(active?.activeLabel).toBe("Notes grid");
    const failed = diagnoseLayoutFallback(
      host,
      catalog,
      viewId,
      undefined,
      {},
      { [viewId]: "fetch failed" },
    );
    expect(failed).toMatchObject({
      targetExtensionId: viewId,
      reason: "模块加载失败：fetch failed",
    });
  },
);
it.each(["constructor", "toString"])(
  "ignores inherited string hints and failures for %s",
  (viewId) => {
    const host = new Host(createPlatform());
    const catalog: import("../modules/shell/uninstall").ImportedExtension[] = [
      {
        id: "first.ui",
        url: "/first.js",
        label: "First",
        views: Object.create({ [viewId]: "Inherited label" }),
      },
    ];
    const result = diagnoseLayoutFallback(
      host,
      catalog,
      viewId,
      undefined,
      {},
      Object.create({ [viewId]: "Inherited failure" }),
    );
    expect(result).toMatchObject({
      label: viewId,
      targetExtensionId: undefined,
      reason: "对应界面扩展尚未启用",
    });
  },
);
