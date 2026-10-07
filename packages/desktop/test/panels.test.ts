import { it, expect } from "vitest";
import { _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, cp, mkdir, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { createArchive, MemorySecretStore, type ManifestV2 } from "@plums/core";
import { DesktopHost } from "../../host/src/host.js";

it("displays isolated bound panels, authenticates student messages and rejects network/navigation and expired view identities across screen lifecycles", async () => {
  const temporary = await mkdtemp(
      path.join(os.tmpdir(), "plums-panel-desktop-"),
    ),
    dataDir = path.join(temporary, "profile");
  const host = new DesktopHost({
    dataDir,
    secretStore: () => new MemorySecretStore(),
    confirm: { ask: async () => true },
  });
  await host.initialize();
  const style = `:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;padding:24px;font:16px/1.5 system-ui;background:#f7f6f3;color:#24241f}h1{font-size:22px;margin:0 0 12px}button,input{font:inherit;min-height:44px;max-width:100%;padding:8px;border:1px solid #777;border-radius:6px}button{background:#e2e4da;color:#24241f}p{overflow-wrap:anywhere}label{display:grid;gap:8px}input{width:100%;background:#fff;color:#24241f}:focus-visible{outline:3px solid #287451;outline-offset:3px}@media(prefers-color-scheme:dark){body{background:#20201e;color:#f4f4ef}button{background:#383b33;color:#f4f4ef}input{background:#292a26;color:#f4f4ef}}@media(max-width:500px){body{padding:16px}h1{font-size:20px}}`;
  const items = [];
  for (const id of ["classroom", "board-a", "board-b"]) {
    const root = id === "classroom";
    const manifest: ManifestV2 = {
      formatVersion: "2.0",
      id,
      kind: "extension",
      name: id,
      version: "1.0.0",
      description: "",
      dependencies: [],
      permissions: [],
      payload: {
        plumsDesktop: {
          sdkVersion: "2",
          runtime: "main.js",
          ...(root
            ? { frontend: "index.html" }
            : {
                panels: [
                  {
                    id: "board",
                    title: id,
                    entry: "index.html",
                    provideId: "board",
                    messageVersion: "1.0",
                    topics: ["answer", "present"],
                  },
                ],
              }),
          contributes: root
            ? { commands: [{ name: "answer", title: "Answer" }] }
            : { tools: [{ name: "board", title: "Board" }] },
          protocols: root
            ? {
                requires: [
                  {
                    id: "left",
                    protocol: "org.example.board",
                    range: "^1.0.0",
                  },
                  {
                    id: "right",
                    protocol: "org.example.board",
                    range: "^1.0.0",
                  },
                ],
              }
            : {
                provides: [
                  {
                    id: "board",
                    protocol: "org.example.board",
                    version: "1.0.0",
                    contribution: { kind: "tools", name: "board" },
                  },
                ],
              },
        },
      },
    };
    const html = root
      ? `<h1>课堂</h1><button id="open">打开练习面板</button><p id="result" role="status">等待回答</p>`
      : `<h1>${id === "board-a" ? "练习 A" : "练习 B"}</h1><label>你的回答<input id="answer" value="synthetic-student-answer"></label><button id="submit">提交回答</button>`;
    const script = root
      ? `window.messages=[];window.unsubscribe=plums.panels.onMessage(async m=>{window.messages.push(m);try{const r=await plums.panels.respond(m.messageId,'commands','answer',m.data);document.querySelector('#result').textContent=r.answer;}catch(e){window.responseError=e;}});window.openBoards=async()=>{const left=await plums.panels.open('left','board'),right=await plums.panels.open('right','board');window.handles={left,right};await window.arrange(false);};window.arrange=async narrow=>plums.panels.layout(narrow?{root:{x:0,y:0,width:1,height:.4},panels:[{handle:window.handles.left.handle,x:0,y:.4,width:1,height:.3},{handle:window.handles.right.handle,x:0,y:.7,width:1,height:.3}]}:{root:{x:0,y:0,width:.4,height:1},panels:[{handle:window.handles.left.handle,x:.4,y:0,width:.3,height:1},{handle:window.handles.right.handle,x:.7,y:0,width:.3,height:1}]});document.querySelector('#open').onclick=()=>window.openBoards().catch(e=>window.openError=e);`
      : `document.querySelector('#submit').onclick=()=>plums.panels.post({version:'1.0',to:window.own.parentHandle,topic:'answer',data:{answer:document.querySelector('#answer').value}}).catch(e=>window.postError=e);`;
    const preview = (await host.preview(
      await createArchive({
        "manifest.json": Buffer.from(JSON.stringify(manifest)),
        "main.js": Buffer.from(
          root
            ? `export function activate(s){s.register('commands','answer',async x=>({...x,context:await s.context()}));}`
            : `export function activate(s){s.register('tools','board',async x=>{await s.emit('legacy.reply',{text:'synthetic-legacy-body'});return x;})}`,
        ),
        "index.html": Buffer.from(
          `<!doctype html><meta charset="utf-8"><title>${id}</title><link rel="stylesheet" href="style.css">${html}<script src="ui.js"></script>`,
        ),
        "style.css": Buffer.from(style),
        "ui.js": Buffer.from(
          `${script}plums.context().then(c=>{window.own=c;window.fixtureReady=true});`,
        ),
        [`${id}-only.txt`]: Buffer.from(id),
      }),
    )) as { token: string };
    items.push(await host.importLibrary(preview.token));
  }
  const plan = await host.planAssembly(items.map((i) => i.digest));
  const choices = plan.protocols.map(
    (s) =>
      s.candidates.find(
        (c) =>
          c.intent.providerId ===
          (s.requirement.id === "left" ? "board-a" : "board-b"),
      )!.intent,
  );
  const agent = await host.createAgent(
    "Classroom fixture",
    items.map((i) => i.digest),
    undefined,
    "classroom",
    choices,
  );
  for (const id of ["board-a", "board-b", "classroom"])
    await host.enable(agent.instanceId, id);
  await host.close();
  await cp(
    path.resolve("packages/desktop/dist"),
    path.join(temporary, "dist"),
    { recursive: true },
  );
  await writeFile(
    path.join(temporary, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  await mkdir(path.join(temporary, "node_modules"));
  for (const [name, owner] of [
    ["better-sqlite3", "core"],
    ["isolated-vm", "host"],
  ]) {
    const require = createRequire(
      path.resolve(`packages/${owner}/package.json`),
    );
    await symlink(
      path.dirname(require.resolve(`${name}/package.json`)),
      path.join(temporary, "node_modules", name!),
    );
  }
  let networkRequests = 0;
  const server = createServer((_request, response) => {
    networkRequests++;
    response.end("forbidden");
  });
  server.on("upgrade", (_r, socket) => {
    networkRequests++;
    socket.destroy();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const require = createRequire(path.resolve("packages/desktop/package.json"));
  const application = await electron.launch({
    executablePath: require("electron"),
    args: [path.join(temporary, "dist/main.js")],
    env: {
      ...process.env,
      PLUMS_NODE: process.execPath,
      PLUMS_DATA_DIR: dataDir,
    },
  });
  try {
    const manager = await application.firstWindow();
    await manager.getByTestId("nav-tab-home").waitFor();
    const script = async (id: string, code: string) =>
      application.evaluate(
        async ({ webContents }, { id, code }) => {
          const w = webContents
            .getAllWebContents()
            .find(
              (w) =>
                w.getURL().startsWith("plums-agent://") && w.getTitle() === id,
            );
          if (!w) return undefined;
          return w.executeJavaScript(code);
        },
        { id, code },
      );
    const open = () =>
      manager.evaluate(
        (id) => window.manager.call("openAgent", { instanceId: id }),
        agent.instanceId,
      );
    expect(await open()).toBe(true);
    await expect
      .poll(() => script("classroom", "window.fixtureReady"))
      .toBe(true);
    await script("classroom", "window.openBoards()");
    for (const id of ["board-a", "board-b"])
      await expect.poll(() => script(id, "window.fixtureReady")).toBe(true);
    await script(
      "classroom",
      "window.legacyEvents=[];plums.onEvent(e=>window.legacyEvents.push(e));true",
    );
    await script("classroom", "plums.protocols.invoke('left',null)");
    await expect
      .poll(() => script("classroom", "window.legacyEvents"))
      .toContainEqual({
        packageId: "board-a",
        topic: "legacy.reply",
        data: { text: "synthetic-legacy-body" },
      });
    const contexts = (await Promise.all(
      ["classroom", "board-a", "board-b"].map((id) =>
        script(id, "window.plums.context()"),
      ),
    )) as any[];
    expect(contexts.map((c) => c.componentId)).toEqual([
      "classroom",
      "board-a",
      "board-b",
    ]);
    expect(new Set(contexts.map((c) => c.handle)).size).toBe(3);
    const isolation = await application.evaluate(
      ({ webContents, BrowserWindow }) => {
        const views = webContents
          .getAllWebContents()
          .filter((w) => w.getURL().startsWith("plums-agent://"));
        return {
          preferences: views.map((w) => {
            const p = w.getLastWebPreferences();
            return {
              sandbox: p.sandbox,
              contextIsolation: p.contextIsolation,
              nodeIntegration: p.nodeIntegration,
              webSecurity: p.webSecurity,
            };
          }),
          unique: views.every((w, i) =>
            views.slice(i + 1).every((v) => v.session !== w.session),
          ),
          bounds: BrowserWindow.getAllWindows()
            .find((w) => w.getTitle() === "Plums")!
            .contentView.children.map((v) => v.getBounds()),
        };
      },
    );
    expect(isolation.preferences).toEqual(
      Array(3).fill({
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      }),
    );
    expect(isolation.unique).toBe(true);
    expect(isolation.bounds.every((b) => b.y >= 40)).toBe(true);
    expect(
      await script(
        "board-a",
        "({node:typeof require,process:typeof process,manager:typeof manager,opener:window.opener})",
      ),
    ).toEqual({
      node: "undefined",
      process: "undefined",
      manager: "undefined",
      opener: null,
    });
    const submit = (await script(
      "board-a",
      "(()=>{const r=document.querySelector('#submit').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()",
    )) as { x: number; y: number };
    await application.evaluate(({ webContents }, position) => {
      const contents = webContents
        .getAllWebContents()
        .find((w) => w.getTitle() === "board-a")!;
      contents.focus();
      contents.sendInputEvent({
        type: "mouseDown",
        button: "left",
        clickCount: 1,
        ...position,
      });
      contents.sendInputEvent({
        type: "mouseUp",
        button: "left",
        clickCount: 1,
        ...position,
      });
    }, submit);
    await expect
      .poll(() =>
        script("classroom", "document.querySelector('#result').textContent"),
      )
      .toBe("synthetic-student-answer");
    expect(
      await script("classroom", "window.messages[0].from.componentId"),
    ).toBe("board-a");
    const root = contexts[0],
      left = contexts[1],
      right = contexts[2];
    for (const message of [
      {
        version: "1.0",
        to: root.handle,
        topic: "answer",
        data: null,
        from: { componentId: "classroom" },
      },
      { version: "1.0", to: right.handle, topic: "answer", data: null },
      { version: "2.0", to: root.handle, topic: "answer", data: null },
      { version: "1.0", to: root.handle, topic: "other", data: null },
    ])
      expect(
        await script(
          "board-a",
          `plums.panels.post(${JSON.stringify(message)}).then(()=>false,e=>e.code)`,
        ),
      ).toBe("PERMISSION_DENIED");
    expect(
      await script(
        "board-a",
        `plums.panels.open('left','board').then(()=>false,e=>e.code)`,
      ),
    ).toBe("PERMISSION_DENIED");
    expect(
      await script(
        "board-a",
        `fetch('board-b-only.txt').then(r=>r.status,()=>404)`,
      ),
    ).toBe(404);
    expect(
      await script(
        "board-a",
        `fetch(${JSON.stringify(origin)}).then(()=>false,()=>true)`,
      ),
    ).toBe(true);
    expect(
      await script(
        "board-a",
        `new Promise(resolve=>{try{const s=new WebSocket(${JSON.stringify(origin.replace("http:", "ws:"))});s.onerror=()=>resolve(true);s.onopen=()=>resolve(false)}catch{resolve(true)}})`,
      ),
    ).toBe(true);
    const before = await script("board-a", "location.href");
    await script("board-a", `location.href=${JSON.stringify(origin)};true`);
    await expect.poll(() => script("board-a", "location.href")).toBe(before);
    expect(
      await script("board-a", `window.open(${JSON.stringify(origin)})===null`),
    ).toBe(true);
    expect(networkRequests).toBe(0);
    const screenshots = path.resolve(
      ".artifacts/extension-composition/phase3-ui",
    );
    await mkdir(screenshots, { recursive: true });
    for (const [theme, width] of [
      ["light", 1180],
      ["dark", 760],
      ["light", 375],
      ["dark", 320],
    ] as const) {
      await manager.evaluate(
        (theme) => window.manager.call("setDesktopTheme", { theme }),
        theme,
      );
      await application.evaluate(({ BrowserWindow }, width) => {
        const w = BrowserWindow.getAllWindows().find(
          (w) => w.getTitle() === "Plums",
        )!;
        w.setMinimumSize(300, 640);
        w.setContentSize(width, 800);
      }, width);
      await script("classroom", `window.arrange(${width < 800})`);
      const frames = await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.getTitle() === "Plums")!
          .contentView.children.map((v) => ({
            bounds: v.getBounds(),
            visible: v.getVisible(),
          })),
      );
      expect(frames).toHaveLength(3);
      expect(
        frames.every(
          (f) =>
            f.visible &&
            f.bounds.y >= 40 &&
            f.bounds.width > 0 &&
            f.bounds.height > 0,
        ),
      ).toBe(true);
      await writeFile(
        path.join(screenshots, `${theme}-${width}-layout.json`),
        JSON.stringify(frames, null, 2),
      );
      for (const id of ["classroom", "board-a", "board-b"]) {
        // WebContentsView targets are not all exposed as Playwright Pages.
        // Emulate this disposable view's media through its own native debugger.
        await application.evaluate(
          async ({ webContents }, { id, theme }) => {
            const contents = webContents
              .getAllWebContents()
              .find((w) => w.getTitle() === id)!;
            if (!contents.debugger.isAttached())
              contents.debugger.attach("1.3");
            await contents.debugger.sendCommand("Emulation.setEmulatedMedia", {
              features: [{ name: "prefers-color-scheme", value: theme }],
            });
          },
          { id, theme },
        );
        await script(
          id,
          "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))",
        );
        expect(
          await script(id, "document.documentElement.scrollWidth<=innerWidth"),
        ).toBe(true);
        expect(
          await script(id, "matchMedia('(prefers-color-scheme:dark)').matches"),
        ).toBe(theme === "dark");
        const screen = await application.evaluate(
          async ({ webContents }, id) =>
            (
              await webContents
                .getAllWebContents()
                .find((w) => w.getTitle() === id)!
                .capturePage()
            )
              .toPNG()
              .toString("base64"),
          id,
        );
        const pixels = Buffer.from(screen, "base64");
        expect(pixels.length).toBeGreaterThan(1000);
        await writeFile(
          path.join(screenshots, `${theme}-${width}-${id}.png`),
          pixels,
        );
      }
    }
    await script("classroom", "window.unsubscribe()");
    const count = await script("classroom", "window.messages.length");
    await script("board-a", "document.querySelector('#submit').click()");
    // A round trip through the sender confirms delivery processing before asserting unsubscription.
    await script("board-a", "plums.context()");
    expect(await script("classroom", "window.messages.length")).toBe(count);
    await script(
      "classroom",
      `plums.panels.close(${JSON.stringify(left.handle)})`,
    );
    await expect.poll(() => script("board-a", "true")).toBeUndefined();
    expect(
      await script(
        "classroom",
        `plums.panels.post({version:'1.0',to:${JSON.stringify(left.handle)},topic:'present',data:null}).then(()=>false,e=>e.code)`,
      ),
    ).toBe("PERMISSION_DENIED");
    await script("classroom", "window.openBoards()");
    await expect
      .poll(() => script("board-a", "window.fixtureReady"))
      .toBe(true);
    const newLeft = (await script("board-a", "window.plums.context()")) as any;
    expect(newLeft.handle).not.toBe(left.handle);
    await application.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .find((w) => w.getTitle() === "board-b")!
        .forcefullyCrashRenderer(),
    );
    await expect.poll(() => script("board-b", "true")).toBeUndefined();
    expect(
      await script("classroom", "plums.context().then(c=>c.componentId)"),
    ).toBe("classroom");
    await script("classroom", "window.openBoards()");
    await expect
      .poll(() => script("board-b", "window.fixtureReady"))
      .toBe(true);
    await script("classroom", "plums.openManager()");
    expect(await script("board-a", "window.fixtureReady")).toBe(true);
    await manager.evaluate(() => window.manager.call("showAgent"));
    await script("classroom", "plums.cancel()");
    await expect.poll(() => script("board-a", "true")).toBeUndefined();
    const nextRoot = (await script("classroom", "plums.context()")) as any;
    expect(nextRoot.sessionId).not.toBe(root.sessionId);
    expect(
      await script(
        "classroom",
        `plums.panels.post({version:'1.0',to:${JSON.stringify(newLeft.handle)},topic:'present',data:null}).then(()=>false,e=>e.code)`,
      ),
    ).toBe("PERMISSION_DENIED");
    await script("classroom", "window.openBoards()");
    await expect
      .poll(() => script("board-a", "window.fixtureReady"))
      .toBe(true);
    await manager.evaluate(() => window.manager.call("stopAgent"));
    await expect.poll(() => script("classroom", "true")).toBeUndefined();
    expect(await open()).toBe(true);
    await expect
      .poll(() => script("classroom", "window.fixtureReady"))
      .toBe(true);
    await script("classroom", "window.openBoards()");
    await expect
      .poll(() => script("board-b", "window.fixtureReady"))
      .toBe(true);
    expect(
      ((await script("classroom", "plums.context()")) as any).sessionId,
    ).not.toBe(nextRoot.sessionId);
    expect(
      await manager.evaluate(
        (id) => window.manager.call("audit", { instanceId: id }),
        agent.instanceId,
      ),
    ).not.toContainEqual(expect.objectContaining({ data: expect.anything() }));
    expect(networkRequests).toBe(0);
  } finally {
    await application.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(temporary, { recursive: true, force: true });
  }
}, 60_000);
