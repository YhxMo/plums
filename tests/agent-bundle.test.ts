import { expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  bundleNotes,
  readBundle,
  writeBundle,
} from "../modules/agents/agent-bundle";
import { parseRoleCard } from "../modules/agents/validation";
import { withRoleCard } from "../modules/agents/card-export";
import { tinyPng } from "./fixtures/tiny-png";

const agent = {
  name: "旅伴",
  description: "带你逛京都。",
  instructions: "熟悉京都的向导。",
};
const weather = {
  manifest: JSON.stringify({
    id: "example.weather",
    version: "1.2.0",
    apiVersion: 1,
    author: "某作者",
    license: "MIT",
  }),
  main: "export default { activate() {} };",
};
const parts = [
  { id: "agents.local", version: "0.0.4" },
  { id: "memory.local", version: "0.0.1" },
  { id: "example.weather", version: "1.2.0", package: weather },
];

it("packs the card, which parts it uses and switched off, and only third-party code", async () => {
  const zip = writeBundle({
    card: withRoleCard(tinyPng(), agent),
    extensions: parts,
    off: ["memory.local"],
  });
  const files = unzipSync(zip);
  expect(Object.keys(files).sort()).toEqual([
    "agent.json",
    "card.png",
    "extensions/example.weather/main.js",
    "extensions/example.weather/manifest.json",
  ]);
  expect(JSON.parse(new TextDecoder().decode(files["agent.json"]))).toEqual({
    version: 1,
    extensions: [
      { id: "agents.local", version: "0.0.4", packaged: false },
      { id: "memory.local", version: "0.0.1", packaged: false },
      { id: "example.weather", version: "1.2.0", packaged: true },
    ],
    off: ["memory.local"],
  });
  const read = await readBundle(new Blob([zip]));
  expect(parseRoleCard(read.card.text)).toEqual({
    name: "旅伴",
    description: "带你逛京都。",
    instructions: "熟悉京都的向导。",
  });
  expect(read.card.picture).toBeInstanceOf(Blob);
  expect(read.off).toEqual(["memory.local"]);
  expect(read.packages).toEqual([{ id: "example.weather", ...weather }]);
});

it("refuses a bundle that is not one, or whose folders and manifests disagree", async () => {
  const card = withRoleCard(tinyPng(), agent);
  const bundle = (files: Record<string, Uint8Array>) =>
    readBundle(new Blob([zipSync(files)]));
  const json = (value: unknown) => strToU8(JSON.stringify(value));
  const meta = {
    version: 1,
    extensions: [{ id: "example.weather", version: "1.2.0", packaged: true }],
    off: [],
  };
  await expect(readBundle(new Blob(["not a zip"]))).rejects.toThrow(
    "不是 Plums 的 Agent 文件",
  );
  await expect(bundle({ "card.png": card })).rejects.toThrow(
    "不是 Plums 的 Agent 文件",
  );
  await expect(
    bundle({ "card.png": card, "agent.json": json({ ...meta, version: 2 }) }),
  ).rejects.toThrow("不是 Plums 的 Agent 文件");
  // A packaged extension must be in its own folder, named by its ID.
  await expect(
    bundle({ "card.png": card, "agent.json": json(meta) }),
  ).rejects.toThrow("example.weather");
  await expect(
    bundle({
      "card.png": card,
      "agent.json": json(meta),
      "extensions/example.weather/manifest.json": strToU8(
        JSON.stringify({ id: "other.id", version: "1.2.0", apiVersion: 1 }),
      ),
      "extensions/example.weather/main.js": strToU8(weather.main),
    }),
  ).rejects.toThrow("example.weather");
});

it("says which parts the app lacks or has in an incompatible version", () => {
  expect(
    bundleNotes(
      [
        { id: "agents.local", version: "0.0.4", packaged: false },
        { id: "memory.local", version: "0.0.1", packaged: false },
        { id: "connector.models", version: "2.0.0", packaged: false },
        { id: "example.weather", version: "1.2.0", packaged: true },
      ],
      [
        { id: "agents.local", version: "0.0.5", label: "Agent 核心" },
        { id: "connector.models", version: "1.4.0", label: "模型连接" },
      ],
      [{ id: "example.weather", outcome: "declined" }],
    ),
  ).toEqual([
    { id: "memory.local", text: "memory.local 没有安装，这一项保持关闭。" },
    {
      id: "connector.models",
      text: "包里的「模型连接」是 2.0.0，这里是 1.4.0，版本不兼容，这一项保持关闭。",
    },
    {
      id: "example.weather",
      text: "没有安装 example.weather，这一项保持关闭。",
    },
  ]);
});
