import { expect, test } from "@playwright/test";
import { manage, openSettings } from "./helpers";

test("React views release cleanly across layout and extension lifecycles", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      errors.push(message.text());
  });
  await page.goto("/");
  await manage(page, true);
  await page
    .getByRole("button", { name: "授予实验能力并启动", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "授权并启动", exact: true })
    .click();
  await openSettings(page);
  await page
    .getByRole("radio", { name: "使用 Agent 界面", exact: true })
    .click();
  await manage(page);
  await page
    .getByRole("button", { name: "停用 ui.agents", exact: true })
    .click();
  await page
    .getByRole("button", { name: "启用 ui.agents", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await expect(page.locator('button[aria-label="添加"]')).toBeVisible();
  expect(errors).toEqual([]);
});

for (const width of [375, 1280])
  test(`long Agent conversations keep the composer visible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.addInitScript(() => {
      localStorage.setItem(
        "plums:m1:host.shell",
        JSON.stringify({
          schema: 1,
          revision: 1,
          value: {
            version: 1,
            agents: [
              {
                id: "layout",
                name: "Layout",
                description: "Long conversation",
                pinned: false,
                extensionId: "agents.local",
                model: { provider: "chat.echo", model: "echo-a" },
                currentSessionId: "session",
                sessions: [
                  {
                    id: "session",
                    title: "Long",
                    createdAt: 1,
                    lastMessageAt: 1,
                    messages: Array.from({ length: 40 }, (_, i) => ({
                      id: String(i),
                      role: i % 2 ? "agent" : "user",
                      text: `Message ${i}: ${"long conversation ".repeat(10)}`,
                    })),
                  },
                ],
              },
            ],
          },
        }),
      );
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: "与 Layout 交互", exact: true })
      .click();
    const log = page.getByRole("log");
    await expect(log).toBeVisible();
    expect(await log.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
      true,
    );
    await expect(
      page.getByRole("button", { name: "发送", exact: true }),
    ).toBeInViewport();
    expect(
      await page
        .getByRole("textbox", { name: "消息", exact: true })
        .evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight),
    ).toBe(true);
  });

test("overlapping React view releases retain the replacement and release subscriptions", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const hostPath = "/modules/extension-host/host.ts";
    const uiPath = "/src/agents/extension.tsx";
    const { Host } = await import(hostPath);
    const { agentUI } = await import(uiPath);
    const listeners = new Set<() => void>();
    const agents: unknown[] = [];
    const host = new Host({
      kind: "browser",
      available: () => false,
      grant: async () => {},
      call: async () => {},
    });
    host.install({
      manifest: {
        id: "test.agents",
        version: "1",
        apiVersion: 1,
        provides: { agents: 1 },
      },
      activate(ctx: import("../../modules/sdk").ExtensionContext) {
        ctx.provide("agents", 1, {
          info: { label: "测试", version: "1", description: "" },
          list: () => agents,
          subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        });
      },
    });
    host.install(agentUI());
    await host.start("test.agents");
    await host.start("ui.agents");
    const container = document.createElement("div");
    document.body.append(container);
    const until = async (label: string, predicate: () => boolean) => {
      const deadline = performance.now() + 2000;
      while (!predicate()) {
        if (performance.now() > deadline)
          throw new Error(`timeout waiting for ${label}`);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
    const first = host.mountView("agents", container);
    await until(
      "initial mount",
      () => container.childElementCount > 0 && listeners.size > 0,
    );
    const initial = listeners.size;
    const release = first();
    const second = host.mountView("agents", container);
    await release;
    await until(
      "replacement mount",
      () =>
        container.textContent?.includes("欢迎使用 Plums") === true &&
        listeners.size > 0,
    );
    const replacement = {
      nodes: container.childElementCount,
      visible: container.textContent?.includes("欢迎使用 Plums"),
      subscriptions: listeners.size,
    };
    const pending = second();
    await Promise.all([pending, host.stop("ui.agents")]);
    await until("final release", () => container.childElementCount === 0);
    const final = {
      nodes: container.childElementCount,
      subscriptions: listeners.size,
    };
    container.remove();
    return {
      initial,
      replacement,
      final,
      status: host.inspect("ui.agents").status,
    };
  });
  expect(result).toEqual({
    initial: 1,
    replacement: { nodes: 1, visible: true, subscriptions: 1 },
    final: { nodes: 0, subscriptions: 0 },
    status: "disabled",
  });
});
