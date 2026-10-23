import { deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { addAgent } from "./helpers";
import { plumFor, plumParts } from "../../src/agents/plum";

/** A PNG with a gradient, `w` × `h` pixels. */
function png(w: number, h: number) {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const at = y * (w * 3 + 1) + 1 + x * 3;
      rows.set([(x * 255) / w, (y * 255) / h, 160], at);
    }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const fallback = (page: Page, name: string) =>
  page
    .getByRole("button", { name: new RegExp(`与 ${name} 交互`) })
    .locator('[data-slot="avatar-fallback"]');

/** The computed colour of a hex value. */
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};

for (const scheme of ["light", "dark"] as const)
  test(`agents without a picture get a flat plum in their name's colours (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await addAgent(page, "编程助手");
    const mark = fallback(page, "编程助手");
    // A drawing, not the first character of the name.
    await expect(mark).toHaveText("");
    const plum = plumFor("编程助手");
    const fill = (part: string) =>
      mark
        .locator(`[data-plum="${part}"]`)
        .evaluate((el) => getComputedStyle(el).fill);
    expect(await fill("tile")).toBe(rgb(plum[scheme]));
    expect(await fill("body")).toBe(rgb(plum.body));
    expect(await fill("leaf")).toBe(rgb(plumParts.leaf));
    // Flat: no highlight, blush or shadow.
    await expect(mark.locator("[data-plum]")).toHaveCount(6);
    expect(
      await mark
        .locator("svg")
        .evaluate(
          (el) => getComputedStyle(el).filter + getComputedStyle(el).boxShadow,
        ),
    ).toBe("nonenone");
  });

for (const width of [1280, 375]) {
  test(`a picture uploaded in the details is cropped square and shown in the list, header and details, then removed at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await addAgent(page, "小梅");
    await page.getByRole("button", { name: "展开或收起右侧栏" }).click();
    const details = page
      .getByRole("complementary", { name: "Agent 详情" })
      .or(page.getByRole("dialog", { name: "Agent 详情", exact: true }));
    await details.getByRole("button", { name: "更换头像" }).click();
    await expect(page.getByRole("menuitem", { name: "移除头像" })).toHaveCount(
      0,
    );
    await page.keyboard.press("Escape");
    await page.getByLabel("选择头像图片").setInputFiles({
      name: "face.png",
      mimeType: "image/png",
      buffer: png(600, 300),
    });
    const shown = details.locator('[data-slot="avatar-image"]');
    await expect(shown).toBeVisible();
    // Square, small, and the same picture everywhere it is shown.
    const size = await shown.evaluate((el: HTMLImageElement) => [
      el.naturalWidth,
      el.naturalHeight,
      el.src.length,
    ]);
    expect(size[0]).toBe(256);
    expect(size[1]).toBe(256);
    expect(size[2]).toBeLessThanOrEqual(40_000);
    const src = await shown.getAttribute("src");
    // On phones the details cover the chat; close them to see it.
    if (width < 768)
      await details.getByRole("button", { name: "收起详情" }).click();
    const places = [page.getByRole("region", { name: "小梅 的会话" })];
    // On phones the list is a page of its own, not on screen beside the chat.
    if (width >= 768)
      places.push(page.getByRole("button", { name: "与 小梅 交互" }));
    for (const place of places)
      await expect(
        place.locator('[data-slot="avatar-image"]').first(),
      ).toHaveAttribute("src", src!);
    await page.reload();
    await page.getByRole("button", { name: "展开或收起右侧栏" }).click();
    await expect(details.locator('[data-slot="avatar-image"]')).toHaveAttribute(
      "src",
      src!,
    );
    await details.getByRole("button", { name: "更换头像" }).click();
    await page.getByRole("menuitem", { name: "移除头像" }).click();
    await expect(details.locator('[data-slot="avatar-image"]')).toHaveCount(0);
    await expect(
      details.locator('[data-slot="avatar-fallback"] [data-plum="body"]'),
    ).toBeVisible();
    await page.evaluate(() => localStorage.clear());
  });
}

test("a file that is not a readable picture is refused with the reason", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await addAgent(page, "小梅");
  await page.getByRole("button", { name: "展开或收起右侧栏" }).click();
  await page.getByLabel("选择头像图片").setInputFiles({
    name: "face.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("不是图片"),
  });
  await expect(page.getByText(/格式不支持/)).toBeVisible();
});

test("an imported role card brings its avatar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const image = png(64, 64);
  const avatar = `data:image/png;base64,${image.toString("base64")}`;
  await page.getByRole("button", { name: /导入角色卡/ }).click();
  await page.getByLabel("角色卡文件").setInputFiles({
    name: "role.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ version: 1, name: "带像卡", avatar })),
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "带像卡 的会话" })
      .locator('[data-slot="avatar-image"]')
      .first(),
  ).toHaveAttribute("src", avatar);
});
