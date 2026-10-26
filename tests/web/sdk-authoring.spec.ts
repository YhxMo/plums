import { test, expect } from "@playwright/test";
import { manage, openSettings, installByPath, pickLayout } from "./helpers";

for (const width of [375, 768, 1440]) {
  test(`author samples install and pause/resume without a chat layout at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await manage(page);
    for (const name of ["events", "panel", "counter"]) {
      await page.getByRole("button", { name: "安装扩展", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "安装扩展" });
      await installByPath(page, `/examples/${name}/`);
      await expect(dialog).not.toBeVisible();
      await page
        .getByRole("switch", { name: `启用 sample.${name}`, exact: true })
        .click();
    }
    await openSettings(page);
    await pickLayout(page, "计数样板");
    await page.getByRole("button", { name: "返回工作区", exact: true }).click();
    const increment = page.getByRole("button", {
      name: "增加计数",
      exact: true,
    });
    await increment.click();
    await expect(
      page.getByRole("status").filter({ hasText: "计数：" }),
    ).toHaveText("计数：1");
    await manage(page);
    await page
      .getByRole("switch", { name: "启用 sample.events", exact: true })
      .click();
    await page.getByRole("button", { name: "返回工作区", exact: true }).click();
    await increment.click();
    await expect(
      page.getByRole("status").filter({ hasText: "计数：" }),
    ).toHaveText("计数：1");
    await manage(page);
    await page
      .getByRole("switch", { name: "启用 sample.events", exact: true })
      .click();
    await page.getByRole("button", { name: "返回工作区", exact: true }).click();
    await increment.click();
    await expect(
      page.getByRole("status").filter({ hasText: "计数：" }),
    ).toHaveText("计数：2");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("browser uninstall revokes access, retains stored state, and permits explicit reinstall", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const hostPath = "/modules/extension-host/host.ts";
    const platformPath = "/src/platform.ts";
    const { Host } = await import(hostPath);
    const { PlatformAdapter } = await import(platformPath);
    const adapter = new PlatformAdapter();
    const host = new Host(adapter);
    let ctx: import("../../modules/sdk").ExtensionContext;
    const definition: import("../../modules/sdk").ExtensionDefinition = {
      manifest: {
        id: "author.state",
        version: "1",
        apiVersion: 1,
        capabilities: ["state.read", "state.write"],
      },
      activate(context) {
        ctx = context;
      },
    };
    host.install(definition);
    await host.grant("author.state", ["state.read", "state.write"]);
    await host.start("author.state");
    await ctx!.platform("state.write", {
      revision: 0,
      value: { synthetic: true },
    });
    await host.stop("author.state");
    await host.uninstall("author.state");
    let denied = false;
    try {
      await adapter.call("extension.author.state", "state.read");
    } catch {
      denied = true;
    }
    host.install(definition);
    await host.start("author.state");
    const waiting = host.inspect("author.state").status;
    await host.grant("author.state", ["state.read", "state.write"]);
    const saved = await ctx!.platform("state.read");
    await host.stop("author.state");
    await host.uninstall("author.state");
    return { denied, waiting, saved, ids: host.ids() };
  });
  expect(result).toEqual({
    denied: true,
    waiting: "waiting",
    saved: { schema: 1, revision: 1, value: { synthetic: true } },
    ids: [],
  });
});

test("sample provider replacement releases the mounted panel and rebinds both consumers", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const hostPath = "/modules/extension-host/host.ts";
    const platformPath = "/src/platform.ts";
    const { Host } = await import(hostPath);
    const definitionPath = "/modules/extension-host/definition.ts";
    const { loadExtension } = await import(definitionPath);
    const { PlatformAdapter } = await import(platformPath);
    const host = new Host(new PlatformAdapter());
    for (const name of ["counter", "events", "panel"]) {
      host.install(
        await loadExtension(
          new URL(`/examples/${name}/`, location.href).href,
          `sample.${name}`,
        ),
      );
      await host.start(`sample.${name}`);
    }
    const root = document.createElement("div");
    document.body.append(root);
    const close = host.mountView("sample.panel", root);
    const oldButton = root.querySelector("button")!;
    oldButton.click();
    const before = root.querySelector("[role=status]")!.textContent;
    await host.stop("sample.counter");
    await close();
    const released = root.childElementCount === 0 && host.views().length === 0;
    const stopped = ["sample.counter", "sample.events", "sample.panel"].map(
      (id) => host.inspect(id),
    );
    let count = 100;
    host.install({
      manifest: {
        id: "sample.replacement",
        version: "1",
        apiVersion: 1,
        provides: { "sample.counter": 1 },
      },
      activate(ctx: import("../../modules/sdk").ExtensionContext) {
        ctx.provide("sample.counter", 1, {
          read: () => count,
          increment: () => ++count,
        });
      },
    });
    await host.start("sample.replacement");
    const closeNew = host.mountView("sample.panel", root);
    oldButton.click();
    const detachedClickIgnored = count === 100;
    root.querySelector("button")!.click();
    const after = root.querySelector("[role=status]")!.textContent;
    await host.stop("sample.replacement");
    await closeNew();
    root.remove();
    return { before, released, stopped, detachedClickIgnored, after };
  });
  expect(result.before).toBe("计数：1");
  expect(result.released).toBe(true);
  expect(
    result.stopped.map((entry: { resources: number }) => entry.resources),
  ).toEqual([0, 0, 0]);
  expect(result.detachedClickIgnored).toBe(true);
  expect(result.after).toBe("计数：101");
});
