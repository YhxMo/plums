import { expect, it } from "vitest";
import {
  desktopContribution,
  copyPanelPost,
  copyPanelLayout,
  createAgentBundle,
  validateAgentBundle,
  type DesktopContribution,
  type PanelDeclaration,
} from "../src/index.js";
import { createArchive, type ManifestV2 } from "@plums/core";

const panel: PanelDeclaration = {
  id: "board",
  title: "Board",
  entry: "board.html",
  provideId: "board",
  messageVersion: "1.0",
  topics: ["answer", "present"],
};
function fixture(): ManifestV2 {
  return {
    formatVersion: "2.0",
    id: "board",
    kind: "extension",
    name: "Board",
    version: "1.0.0",
    description: "",
    dependencies: [],
    permissions: [],
    payload: {
      plumsDesktop: {
        sdkVersion: "2",
        runtime: "main.js",
        panels: [structuredClone(panel)],
        contributes: { tools: [{ name: "board", title: "Board" }] },
        protocols: {
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
}
it("accepts bound panel metadata, keeps legacy frontends and preserves unknown panel fields through ZIPs", async () => {
  const m = fixture();
  (m.payload as any).plumsDesktop.panels[0].future = { mode: "retain" };
  expect(
    desktopContribution(m, {
      "board.html": new Uint8Array(),
      "main.js": new Uint8Array(),
    })?.panels?.[0]?.id,
  ).toBe("board");
  expect(
    desktopContribution({
      ...m,
      payload: { plumsDesktop: { sdkVersion: "1", frontend: "board.html" } },
    })?.frontend,
  ).toBe("board.html");
  const bytes = await createArchive({
    "manifest.json": Buffer.from(JSON.stringify(m)),
    "board.html": Buffer.from("<title>Board</title>"),
    "main.js": Buffer.from(
      "export function activate(s){s.register('tools','board',x=>x)}",
    ),
  });
  const bundle = await validateAgentBundle(
    await createAgentBundle(
      {
        bundleVersion: "1.0",
        id: "test",
        name: "Test",
        version: "1.0.0",
        extensions: ["board.zip"],
        connectors: [],
      },
      { "board.zip": bytes },
    ),
  );
  expect(
    (
      desktopContribution(bundle.packages[0]!.contents.manifest)
        ?.panels?.[0] as any
    ).future,
  ).toEqual({ mode: "retain" });
});
it.each([
  [
    "SDK version",
    (c: DesktopContribution) => {
      c.sdkVersion = "1";
      delete c.protocols;
    },
    "",
  ],
  [
    "duplicate id",
    (c: DesktopContribution) => {
      c.panels!.push(structuredClone(panel));
    },
    "/1/id",
  ],
  [
    "missing entry",
    (c: DesktopContribution) => {
      c.panels![0]!.entry = "missing.html";
    },
    "/0/entry",
  ],
  [
    "traversal",
    (c: DesktopContribution) => {
      c.panels![0]!.entry = "../private.html";
    },
    "/0/entry",
  ],
  [
    "unbound provide id",
    (c: DesktopContribution) => {
      c.panels![0]!.provideId = "other";
    },
    "/0/provideId",
  ],
  [
    "version",
    (c: DesktopContribution) => {
      (c.panels![0] as any).messageVersion = "2.0";
    },
    "/0/messageVersion",
  ],
  [
    "duplicate topic",
    (c: DesktopContribution) => {
      c.panels![0]!.topics = ["answer", "answer"];
    },
    "/0/topics",
  ],
  [
    "invalid topic",
    (c: DesktopContribution) => {
      c.panels![0]!.topics = ["rejected secret value"];
    },
    "/0/topics",
  ],
] as const)("rejects %s with a safe JSON Pointer", (_name, change, path) => {
  const m = fixture(),
    c = (m.payload as any).plumsDesktop as DesktopContribution;
  change(c);
  try {
    desktopContribution(m, {
      "board.html": new Uint8Array(),
      "main.js": new Uint8Array(),
    });
    throw Error("accepted");
  } catch (e) {
    expect(e).toMatchObject({
      code: "IMPORT_INVALID",
      path: `/payload/plumsDesktop/panels${path}`,
    });
    expect(JSON.stringify(e)).not.toContain("rejected secret value");
  }
});
it("copies JSON messages and rejects identity claims, incompatible versions and unsafe or oversized bodies", () => {
  const message = {
    version: "1.0" as const,
    to: "target",
    topic: "answer",
    data: { answer: "yes" },
  };
  const copied = copyPanelPost(message);
  message.data.answer = "changed";
  expect(copied.data).toEqual({ answer: "yes" });
  const recursive: any = {};
  recursive.child = recursive;
  for (const bad of [
    { ...message, from: "forged" },
    { ...message, version: "2.0" },
    { ...message, data: "学".repeat(23000) },
    { ...message, data: { v: Infinity } },
    { ...message, data: undefined },
    { ...message, data: new Date() },
    { ...message, data: recursive },
  ])
    expect(() => copyPanelPost(bad)).toThrow();
});
it("bounds layouts to the working area and rejects overlap, invalid coordinates and duplicate handles", () => {
  const layout = {
    root: { x: 0, y: 0, width: 0.5, height: 1 },
    panels: [{ handle: "board", x: 0.5, y: 0, width: 0.5, height: 1 }],
  };
  expect(copyPanelLayout(layout)).toEqual(layout);
  for (const bad of [
    { ...layout, root: { ...layout.root, width: 0.6 } },
    { ...layout, root: { ...layout.root, x: -0.1 } },
    { ...layout, root: { ...layout.root, width: NaN } },
    { ...layout, panels: [...layout.panels, ...layout.panels] },
  ])
    expect(() => copyPanelLayout(bad)).toThrow();
});
