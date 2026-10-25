import { afterEach, expect, it, vi } from "vitest";
import {
  pngTextChunks,
  toBase64,
  withPngText,
} from "../modules/agents/card-png";
import {
  readRoleCardFile,
  readRoleCardLink,
} from "../modules/agents/role-card";
import { parseRoleCard } from "../modules/agents/validation";
import { tinyPng } from "./fixtures/tiny-png";

afterEach(() => vi.unstubAllGlobals());

const base64 = toBase64;

const v2 = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "旅伴",
    description: "一位熟悉京都的向导。",
    personality: "耐心、爱讲故事。",
    scenario: "",
    first_mes: "你好！",
    mes_example: "",
    creator_notes: "带你逛京都的 Agent。",
    system_prompt: "",
    post_history_instructions: "",
    alternate_greetings: [],
    tags: [],
    creator: "",
    character_version: "",
    extensions: {},
  },
};

it("writes text chunks a PNG reader finds again, replacing earlier ones", () => {
  const once = withPngText(tinyPng(), { chara: "first" });
  const twice = withPngText(once, { chara: "second", ccv3: "third" });
  expect(Object.fromEntries(pngTextChunks(twice))).toEqual({
    chara: "second",
    ccv3: "third",
  });
  // Still a PNG that ends with IEND.
  expect([...twice.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(new TextDecoder().decode(twice.subarray(-8, -4))).toBe("IEND");
});

it("reads a V2 picture card: description and personality become 设定, creator notes 介绍", async () => {
  const png = withPngText(tinyPng(), { chara: base64(JSON.stringify(v2)) });
  const read = await readRoleCardFile(new Blob([png], { type: "image/png" }));
  expect(read.picture?.type).toBe("image/png");
  expect(parseRoleCard(read.text)).toEqual({
    name: "旅伴",
    description: "带你逛京都的 Agent。",
    instructions: "一位熟悉京都的向导。\n\n耐心、爱讲故事。",
  });
});

it("prefers the V3 chunk over the V2 one", async () => {
  const v3 = {
    ...v2,
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: { ...v2.data, name: "新版旅伴" },
  };
  const png = withPngText(tinyPng(), {
    chara: base64(JSON.stringify(v2)),
    ccv3: base64(JSON.stringify(v3)),
  });
  const read = await readRoleCardFile(new Blob([png]));
  expect(parseRoleCard(read.text).name).toBe("新版旅伴");
});

it("takes Plums' own fields from extensions.plums when a card carries them", () => {
  const card = {
    ...v2,
    data: {
      ...v2.data,
      extensions: {
        plums: { instructions: "原样的设定", description: "原样的介绍" },
      },
    },
  };
  expect(parseRoleCard(JSON.stringify(card))).toEqual({
    name: "旅伴",
    description: "原样的介绍",
    instructions: "原样的设定",
  });
});

it("accepts pasted V2 JSON and the experimental Plums format alike", () => {
  expect(parseRoleCard(JSON.stringify(v2)).name).toBe("旅伴");
  expect(parseRoleCard('{"name":"老格式","description":"介绍"}')).toEqual({
    name: "老格式",
    description: "介绍",
  });
});

it("says a picture without a role card is not one", async () => {
  await expect(readRoleCardFile(new Blob([tinyPng()]))).rejects.toThrow(
    "这张图片里没有角色卡",
  );
});

it("reads picture cards larger than the old 32 KB limit, from a file or a link", async () => {
  const big = { ...v2, data: { ...v2.data, mes_example: "例".repeat(40000) } };
  const png = withPngText(tinyPng(), { chara: base64(JSON.stringify(big)) });
  expect(png.length).toBeGreaterThan(32000);
  const read = await readRoleCardFile(new Blob([png]));
  expect(parseRoleCard(read.text).name).toBe("旅伴");
  vi.stubGlobal("location", {
    href: "http://localhost/",
    origin: "http://localhost",
  });
  vi.stubGlobal("fetch", async () => new Response(png));
  const linked = await readRoleCardLink(
    "/cards/travel.png",
    new AbortController().signal,
  );
  expect(parseRoleCard(linked.text).name).toBe("旅伴");
  expect(linked.picture).toBeInstanceOf(Blob);
});
