import { it, expect } from "vitest";
import { _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { cp, mkdir, symlink, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { SUITE_VERSION } from "../../../scripts/platform-conformance.mjs";
import { open } from "../../../scripts/platform-conformance-host.mjs";
const require = createRequire(import.meta.url);
it.runIf(process.platform === "darwin")(
  "the public fixture crosses real Electron main, preload, broker and host boundaries",
  async () => {
    const packagedApp = process.env.PLUMS_TEST_APP;
    const reportDirectory = path.resolve(
      process.env.PLUMS_CONFORMANCE_REPORT_DIR ??
        ".artifacts/common-contract/stage-6",
    );
    await mkdir(reportDirectory, {
      recursive: true,
    });
    let scenario: any,
      app: Awaited<ReturnType<typeof electron.launch>> | undefined,
      server: ReturnType<typeof createServer> | undefined;
    const report: any = {
      reportVersion: "1.0",
      suiteVersion: SUITE_VERSION,
      profile: packagedApp ? "packaged-native-electron" : "native-electron",
      status: "failed",
      phase: "setup",
      platform: {
        os: process.platform,
        arch: process.arch,
        nodeDriver: process.versions.node,
      },
      provenance: "internal-fixture",
      thirdPartyAuthorVerified: false,
      cases: [],
    };
    try {
      report.sourceDigests = Object.fromEntries(
        await Promise.all(
          [
            "scripts/platform-conformance.mjs",
            "scripts/platform-conformance-host.mjs",
            "packages/desktop/test/platform-conformance-ui.test.ts",
          ].map(async (file) => [
            file,
            createHash("sha256")
              .update(await readFile(path.resolve(file)))
              .digest("hex"),
          ]),
        ),
      );
      scenario = await (await open({ runtime: "controlled-node" })).scenario();
      const compositionPlan = await scenario.host.workspacePlan(
        scenario.metadata.agents.a,
      );
      await scenario.host.setWorkspaceViews(
        scenario.metadata.agents.a,
        "screen-one",
        ["screen-two"],
        compositionPlan.fingerprint,
      );
      await scenario.host.close();
      const stage = path.join(scenario.dataDir, "desktop"),
        root = process.cwd();
      if (!packagedApp) {
        await cp(
          path.join(root, "packages/desktop/dist"),
          path.join(stage, "dist"),
          { recursive: true },
        );
        for (const [name, pkg] of [
          ["isolated-vm", "host"],
          ["better-sqlite3", "core"],
        ]) {
          const resolve = createRequire(
            path.join(root, `packages/${pkg}/package.json`),
          );
          await mkdir(path.join(stage, "node_modules"), { recursive: true });
          await symlink(
            path.dirname(resolve.resolve(name + "/package.json")),
            path.join(stage, "node_modules", name),
          );
        }
      }
      let requests = 0;
      server = createServer((_req, response) => {
        requests++;
        response.end("forbidden");
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const origin = `http://127.0.0.1:${(server.address() as any).port}`;
      report.artifacts = scenario.metadata.artifacts;
      app = await electron.launch({
        executablePath: packagedApp ?? require("electron"),
        args: packagedApp ? [] : [path.join(stage, "dist/main.js")],
        env: {
          ...process.env,
          PLUMS_DATA_DIR: scenario.dataDir,
          PLUMS_NODE: scenario.nodePath,
        },
      });
      report.application = await app.evaluate(({ app }) => ({
        version: app.getVersion(),
        packaged: app.isPackaged,
      }));
      if (packagedApp) {
        expect(report.application).toEqual({
          version: "1.0.0",
          packaged: true,
        });
      }
      report.nativeVersions = await app.evaluate(() => ({
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome,
      }));
      report.phase = "N01-independent-renderers-same-backend";
      const script = (id: string, code: string) =>
        app!.evaluate(
          async ({ webContents }, { id, code }) =>
            webContents
              .getAllWebContents()
              .find(
                (w) =>
                  w.getURL().startsWith("plums-agent://") &&
                  w.getTitle() === id,
              )
              ?.executeJavaScript(code),
          { id, code },
        );
      const page = await app.firstWindow();
      await page.getByRole("article", { name: "查看 Conformance A" }).click();
      await page
        .getByTestId("workspace-composition")
        .getByRole("button", { name: "打开所选主界面" })
        .click();
      await expect
        .poll(
          () => app!.windows().some((p) => p.url().endsWith("confirm.html")),
          { timeout: 5000 },
        )
        .toBe(true);
      const confirmation = app
        .windows()
        .find((p) => p.url().endsWith("confirm.html"))!;
      await confirmation.getByRole("alertdialog").waitFor();
      await confirmation.bringToFront();
      await app.evaluate(({ app, BrowserWindow }) => {
        app.focus({ steal: true });
        BrowserWindow.getAllWindows()
          .find((w) => w.getTitle() === "Plums · 安全确认")
          ?.focus();
      });
      await confirmation.getByTestId("confirm-allow").click();
      for (const id of ["screen-one", "screen-two"])
        await expect
          .poll(() => script(id, "window.fixtureReady"), { timeout: 8000 })
          .toBe(true);
      const one: any = await script("screen-one", "window.run()"),
        two: any = await script("screen-two", "window.run()");
      expect(one.outcome.value.implementation).toBe("one");
      expect(two.outcome.value.implementation).toBe("one");
      const contexts: any = await Promise.all(
        ["screen-one", "screen-two"].map((id) => script(id, "plums.context()")),
      );
      expect(contexts[0].componentId).toBe("screen-one");
      expect(contexts[1].componentId).toBe("screen-two");
      expect(contexts[0].handle).not.toBe(contexts[1].handle);
      report.cases.push({
        id: "N01-independent-renderers-same-backend",
        status: "passed",
      });
      report.phase = "N02-container-handles-and-management-boundary";
      const transferred = await script(
        "screen-one",
        "plums.common.binding('backend').then(b=>b.handle)",
      );
      expect(
        await script(
          "screen-two",
          `plums.common.invoke(${JSON.stringify(transferred)},'echo',null).then(()=>false,e=>e.details.reason)`,
        ),
      ).toBe("STALE_BINDING");
      for (const id of ["screen-one", "screen-two"])
        expect(
          await script(
            id,
            "({node:typeof require,process:typeof process,manager:typeof manager,policy:Object.keys(plums.common.policy)})",
          ),
        ).toEqual({
          node: "undefined",
          process: "undefined",
          manager: "undefined",
          policy: ["status"],
        });
      report.cases.push({
        id: "N02-container-handles-and-management-boundary",
        status: "passed",
      });
      report.phase = "N03-real-navigation-and-network-denial";
      const before = await script("screen-two", "location.href");
      await script(
        "screen-two",
        `location.href=${JSON.stringify(origin)};true`,
      );
      expect(await script("screen-two", "location.href")).toBe(before);
      expect(
        await script(
          "screen-two",
          `fetch(${JSON.stringify(origin)}).then(()=>false,()=>true)`,
        ),
      ).toBe(true);
      expect(requests).toBe(0);
      report.cases.push({
        id: "N03-real-navigation-and-network-denial",
        status: "passed",
      });
      report.phase = "N04-native-async-event-bridge";
      const ordered: any = await script(
        "screen-one",
        "(async()=>{const b=await plums.common.binding('backend');const c=await plums.common.invoke(b.handle,'events',{count:3});const events=[];for await(const e of c.events)events.push(e.sequence);return {events,result:await c.result}})()",
      );
      expect(ordered.events).toEqual([1, 2, 3]);
      expect(ordered.result.sequence).toBe(4);
      expect(ordered.result.executionState).toBe("completed");
      report.cases.push({
        id: "N04-native-async-event-bridge",
        status: "passed",
      });
      report.status = "passed";
    } catch (error) {
      report.cases.push({
        id: report.phase,
        status: "failed",
        failure: { code: "NATIVE_CHECK_FAILED" },
      });
      throw error;
    } finally {
      let cleanupFailed = false;
      for (const cleanup of [
        () => app?.close(),
        () =>
          server?.listening
            ? new Promise<void>((resolve) => server!.close(() => resolve()))
            : undefined,
        () => scenario?.close(),
      ]) {
        try {
          await cleanup();
        } catch {
          cleanupFailed = true;
        }
      }
      if (cleanupFailed) {
        report.status = "failed";
        report.cases.push({
          id: "cleanup",
          status: "failed",
          failure: { code: "NATIVE_CLEANUP_FAILED" },
        });
      }
      delete report.phase;
      await writeFile(
        path.join(reportDirectory, "native-electron.json"),
        JSON.stringify(report, null, 2) + "\n",
      );
      if (cleanupFailed) throw Error("Native conformance cleanup failed");
    }
  },
  30000,
);
