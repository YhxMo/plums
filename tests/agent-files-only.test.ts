import { expect, it } from "vitest";
import { AgentStore } from "../modules/agents/store";
import type { Attachment } from "../modules/agents/contract";
import { summary } from "../src/agents/summary";

const file: Attachment = { kind: "text", name: "笔记.md", text: "内容" };

async function setup() {
  const store = new AgentStore(
    [],
    async () => {},
    async (text, _signal, { attachments }) =>
      `收到${text}${attachments?.map((a) => a.name).join("") ?? ""}`,
  );
  const a = await store.create({ name: "附件" });
  const session = () => store.list()[0].sessions[0];
  return { store, a, session };
}

it("sends files without text and names the session after the first file", async () => {
  const { store, a, session } = await setup();
  await store.send(a.id, "", [file]);
  expect(session().messages.map((m) => m.text)).toEqual(["", "收到笔记.md"]);
  expect(session().messages[0].attachments).toEqual([file]);
  expect(session().title).toBe("笔记.md");
  await expect(store.send(a.id, "  ")).rejects.toThrow("请输入");
});

it("lets an edit drop the text of a message that keeps its files", async () => {
  const { store, a, session } = await setup();
  await store.send(a.id, "看看", [file]);
  await store.edit(a.id, session().id, session().messages[0].id, "");
  expect(session().messages[0]).toMatchObject({
    text: "",
    attachments: [file],
  });
  await store.send(a.id, "纯文字");
  const plain = session().messages[2];
  await expect(store.edit(a.id, session().id, plain.id, "")).rejects.toThrow(
    "请输入",
  );
});

it("sums up a message without text by the files it carries", () => {
  expect(
    summary({
      text: "",
      attachments: [
        file,
        { kind: "image", name: "图.png", mime: "image/png", data: "QUJD" },
      ],
    }),
  ).toBe("[文件] 笔记.md [图片] 图.png");
  expect(summary({ text: "你好", attachments: [file] })).toBe("你好");
});
