import { it, expect } from "vitest";
import { _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, cp, mkdir, symlink, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DesktopHost } from "../../host/src/host.js";
import { MemorySecretStore, createArchive } from "@plumsjs/core";
const require = createRequire(import.meta.url);
it.runIf(process.platform === "darwin")(
  "trusted desktop chooses a third-party exact pin, disables it, and preserves its state through a broker restart",
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "plums-foundation-ui-")),
      root = process.cwd(),
      host = new DesktopHost({
        dataDir: dir,
        nodePath: process.execPath,
        confirm: { ask: async () => true },
        secretStore: () => new MemorySecretStore(),
      });
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      await host.initialize();
      const agent = await host.createAgent("底座管理验证");
      const bytes = await createArchive({
        "manifest.json": Buffer.from(
          JSON.stringify({
            formatVersion: "2.0",
            kind: "extension",
            id: "org.example.independent",
            name: "Independent",
            version: "1.0.0",
            description: "Internal fixture",
            dependencies: [],
            permissions: [],
            payload: {
              plumsFoundation: {
                declarationVersion: "1.0",
                id: "org.example.independent",
                foundationVersion: "1.0",
                entry: "provider.mjs",
                execution: "controlled-node",
                platforms: ["darwin-arm64"],
                features: [
                  "session.invoke",
                  "session.callback",
                  "session.cancel",
                ],
                hostFeatures: [],
                sdks: [
                  {
                    id: "org.plums.sdk",
                    range: "2.0.0",
                    features: ["sdk.register", "sdk.context"],
                  },
                ],
              },
            },
          }),
        ),
        "provider.mjs": await readFile(
          "packages/host/test/fixtures/independent-foundation.mjs",
        ),
      });
      const preview = (await host.preview(bytes)) as { token: string };
      await host.importLibrary(preview.token);
      const selection = (await host.listFoundations())[0]!.selection;
      await host.close();
      const stage = path.join(dir, "desktop");
      await cp("packages/desktop/dist", path.join(stage, "dist"), {
        recursive: true,
      });
      await mkdir(path.join(stage, "node_modules"));
      for (const [name, pkg] of [
        ["isolated-vm", "host"],
        ["better-sqlite3", "core"],
      ]) {
        const resolver = createRequire(
          path.join(root, "packages", pkg!, "package.json"),
        );
        await symlink(
          path.dirname(resolver.resolve(name + "/package.json")),
          path.join(stage, "node_modules", name!),
        );
      }
      const launch = () =>
        electron.launch({
          executablePath: require("electron"),
          args: [path.join(stage, "dist/main.js")],
          env: {
            ...process.env,
            PLUMS_NODE: path.join(
              root,
              ".build-cache/node-v26.5.1-darwin-arm64/bin/node",
            ),
            PLUMS_DATA_DIR: dir,
          },
        });
      app = await launch();
      let page = await app.firstWindow();
      await page.getByTestId("nav-tab-settings").click();
      let manager = page.getByTestId("foundation-manager");
      const panel = manager.getByTestId("foundation-agent");
      await expect
        .poll(() => panel.getByRole("status").textContent())
        .toContain("官方内置");
      await panel
        .getByLabel("为 底座管理验证 选择底座", { exact: true })
        .selectOption(
          JSON.stringify([
            selection.source,
            selection.id,
            selection.version,
            selection.digest,
          ]),
        );
      await panel
        .getByRole("button", { name: "检查兼容", exact: true })
        .click();
      await expect
        .poll(() =>
          panel
            .getByRole("button", { name: "切换并启用", exact: true })
            .isEnabled(),
        )
        .toBe(true);
      await panel
        .getByRole("button", { name: "切换并启用", exact: true })
        .click();
      await expect
        .poll(() => panel.getByRole("status").first().textContent())
        .toContain("第三方公共库");
      await panel
        .getByRole("button", { name: "停用底座", exact: true })
        .click();
      await expect
        .poll(() => panel.getByRole("status").first().textContent())
        .toContain("已停用");
      for (const width of [1440, 720, 320]) {
        await page.setViewportSize({ width, height: 1100 });
        expect(
          await manager.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
        await page.screenshot({
          path: path.join(
            root,
            ".build-cache/foundation-platform/ui/foundation-ui-" +
              width +
              ".png",
          ),
        });
      }
      await app.close();
      app = await launch();
      page = await app.firstWindow();
      await page.getByTestId("nav-tab-settings").click();
      manager = page.getByTestId("foundation-manager");
      await expect
        .poll(() =>
          manager
            .getByTestId("foundation-agent")
            .getByRole("status")
            .first()
            .textContent(),
        )
        .toContain("已停用");
      const actual = await page.evaluate(
        async (instanceId) =>
          window.manager.call("foundationStatus", { instanceId }),
        agent.instanceId,
      );
      expect(actual).toMatchObject({ enabled: false, selection });
      await manager
        .getByTestId("foundation-agent")
        .getByRole("button", { name: "启用底座", exact: true })
        .click();
      await expect
        .poll(() =>
          manager
            .getByTestId("foundation-agent")
            .getByRole("status")
            .first()
            .textContent(),
        )
        .toContain("已启用");
    } finally {
      await app?.close();
      await host.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  60_000,
);
