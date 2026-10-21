import { expect, it } from "vitest";
import {
  LIMITS,
  attachmentProblem,
  decodeText,
  prepareChat,
} from "../modules/agents/attachments";
import type { Attachment } from "../modules/agents/contract";

const file = (name: string, text: string): Attachment => ({
  kind: "text",
  name,
  text,
});
const image = (name: string): Attachment => ({
  kind: "image",
  name,
  mime: "image/webp",
  data: "QUJD",
});

it("accepts a few text files and images and refuses anything else", () => {
  expect(attachmentProblem([file("a.md", "# 标题"), image("p.png")])).toBe(
    undefined,
  );
  expect(attachmentProblem(undefined)).toBe(undefined);
  expect(attachmentProblem("x")).toMatch(/附件/);
  expect(attachmentProblem([{ kind: "pdf", name: "a" }])).toMatch(/附件/);
  expect(
    attachmentProblem(
      Array.from({ length: LIMITS.files + 1 }, () => file("a", "b")),
    ),
  ).toMatch(/最多/);
  expect(
    attachmentProblem(
      Array.from({ length: LIMITS.images + 1 }, () => image("p")),
    ),
  ).toMatch(/图片/);
  expect(attachmentProblem([file("a", "字".repeat(LIMITS.text + 1))])).toMatch(
    /文件/,
  );
  expect(attachmentProblem([{ ...image("p"), mime: "image/gif" }])).toMatch(
    /附件/,
  );
  expect(attachmentProblem([{ ...image("p"), data: "not base64!" }])).toMatch(
    /附件/,
  );
  expect(
    attachmentProblem([{ ...image("p"), data: "A".repeat(LIMITS.image + 4) }]),
  ).toMatch(/图片/);
  expect(attachmentProblem([file("", "x")])).toMatch(/附件/);
});

it("puts text files before the message in one fixed fenced form", () => {
  const { input, history } = prepareChat(
    [{ role: "user", text: "旧", attachments: [file("n.txt", "a\n```\nb")] }],
    { text: "新", attachments: [file("m.md", "内容")] },
    false,
  );
  // A fence longer than any backtick run inside the file.
  expect(history[0].text).toBe("文件「n.txt」：\n````\na\n```\nb\n````\n\n旧");
  expect(input.text).toBe("文件「m.md」：\n```\n内容\n```\n\n新");
});

it("sends images only to models that read them, and only the latest three messages' images", () => {
  const turns = [1, 2, 3, 4].flatMap((n) => [
    { role: "user" as const, text: `u${n}`, attachments: [image(`p${n}.png`)] },
    { role: "agent" as const, text: `a${n}` },
  ]);
  const { history, input } = prepareChat(
    turns,
    { text: "now", attachments: [image("now.png")] },
    true,
  );
  const users = history.filter((t) => t.role === "user");
  // The new input and the two messages before it keep their images.
  expect(input.images).toHaveLength(1);
  expect(users.map((t) => t.images?.length ?? 0)).toEqual([0, 0, 1, 1]);
  // Older ones become a line of text instead.
  expect(users[0].text).toBe("u1\n[图片：p1.png]");
  expect(users[3].text).toBe("u4");

  const plain = prepareChat(
    turns,
    { text: "now", attachments: [image("now.png")] },
    false,
  );
  expect(plain.input).toEqual({ text: "now\n[图片：now.png]" });
  expect(plain.history.every((t) => !t.images)).toBe(true);
});

it("leaves messages without attachments exactly as they were", () => {
  const { history, input } = prepareChat(
    [
      { role: "user", text: "hi" },
      { role: "agent", text: "yo" },
    ],
    { text: "go" },
    true,
  );
  expect(history).toEqual([
    { role: "user", text: "hi" },
    { role: "agent", text: "yo" },
  ]);
  expect(input).toEqual({ text: "go" });
});

it("reads UTF-8 text files and refuses binary, oversized or empty ones", () => {
  const enc = (text: string) => new TextEncoder().encode(text);
  expect(decodeText("a.md", enc("你好\nworld"))).toBe("你好\nworld");
  expect(() => decodeText("a.png", new Uint8Array([0x89, 0xff, 0xfe]))).toThrow(
    "UTF-8",
  );
  expect(() => decodeText("a.bin", enc("ab\0cd"))).toThrow("不是文本");
  expect(() => decodeText("a.txt", enc("  \n"))).toThrow("空");
  expect(() => decodeText("a.txt", enc("x".repeat(LIMITS.text + 1)))).toThrow(
    "太大",
  );
});
