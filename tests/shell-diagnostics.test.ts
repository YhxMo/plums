import { describe, expect, it } from "vitest";
import { Host } from "../modules/extension-host/host";
import {
  diagnoseLayoutFallback,
  mapExtensionAgents,
} from "../modules/shell/diagnostics";
import type { Agent } from "../modules/sdk/agents";
import type { Platform } from "../modules/sdk";
import { errorMessage } from "../src/shell/messages";

const createPlatform = (): Platform => ({
  kind: "browser",
  available: () => true,
  grant: async () => {},
  call: async () => null,
});

const catalog = [
  { id: "transform.upper", url: "/services/upper.js", label: "大写转换服务" },
  { id: "workbench", url: "/services/workbench.js", label: "文本工作台" },
  { id: "ui.default", url: "/ui/default.js", label: "默认工作台布局" },
  { id: "agents.local", url: "内置公开服务", label: "本地 Agent 提供者" },
  { id: "ui.agents", url: "内置可替换界面", label: "默认 Agent 界面" },
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

describe("mapExtensionAgents", () => {
  it("maps enabled agents to their provider, active dependencies and agent UI", async () => {
    const host = new Host(createPlatform());
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
        id: "agents.local",
        version: "0.0.4",
        apiVersion: 1,
        requires: { "text.transform": 1 },
        provides: { agents: 1 },
      },
      activate(ctx) {
        ctx.provide("agents", 1, {});
      },
    });
    host.install({
      manifest: {
        id: "ui.agents",
        version: "0.0.4",
        apiVersion: 1,
        requires: { agents: 1 },
      },
      activate(ctx) {
        ctx.view({
          id: "agents",
          label: "Agent 界面",
          mount: () => () => {},
        });
      },
    });
    await host.start("transform.upper");
    await host.start("agents.local");
    await host.start("ui.agents");

    const sampleAgents: Agent[] = [
      {
        id: "a1",
        name: "代码助手",
        description: "coding",
        status: "idle",
        pinned: false,
        extensionId: "agents.local",
        capabilities: ["本地文本处理"],
        multiSession: true,
        sessions: [],
        currentSessionId: "s1",
      },
    ];

    sampleAgents.push({ ...sampleAgents[0], id: "a2", name: "文字助手" });
    const mapped = mapExtensionAgents(host, sampleAgents);
    for (const id of ["agents.local", "transform.upper", "ui.agents"])
      expect(mapped[id]?.map((agent) => agent.name)).toEqual([
        "代码助手",
        "文字助手",
      ]);
    await host.stop("transform.upper");
    expect(mapExtensionAgents(host, sampleAgents)).toEqual({});
  });
});
