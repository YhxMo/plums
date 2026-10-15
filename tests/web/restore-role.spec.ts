import { expect, test } from "@playwright/test";

function state(role: unknown) {
  return JSON.stringify({
    schema: 1,
    revision: 1,
    value: {
      version: 1,
      layout: "agents",
      theme: "light",
      imports: [],
      agents: [
        {
          id: "restore",
          name: "RestoreRole",
          description: "local test",
          extensionId: "agents.local",
          capabilities: ["local"],
          pinned: false,
          multiSession: false,
          currentSessionId: "session",
          status: "idle",
          sessions: [
            {
              id: "session",
              title: "restore",
              createdAt: 1,
              lastMessageAt: 1,
              messages: [
                { id: "question", role, text: "saved question" },
                { id: "answer", role: "agent", text: "saved answer" },
              ],
            },
          ],
        },
      ],
    },
  });
}

test("invalid saved role blocks boot without replacing persisted bytes", async ({
  page,
}) => {
  const original = state(["user"]);
  await page.addInitScript((raw) => {
    if (!localStorage.getItem("plums:m1:host.shell"))
      localStorage.setItem("plums:m1:host.shell", raw);
  }, original);
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("会话配置损坏");
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("会话配置损坏");
  expect(
    await page.evaluate(() => localStorage.getItem("plums:m1:host.shell")),
  ).toBe(original);
});

test("valid saved roles restore with correct attribution after reload", async ({
  page,
}) => {
  await page.addInitScript((raw) => {
    if (!localStorage.getItem("plums:m1:host.shell"))
      localStorage.setItem("plums:m1:host.shell", raw);
  }, state("user"));
  await page.goto("/");
  for (let attempt = 0; attempt < 2; attempt++) {
    await page
      .getByRole("button", { name: "与 RestoreRole 交互", exact: true })
      .click();
    const question = page
      .getByRole("log")
      .locator("div")
      .filter({ has: page.locator("p", { hasText: "saved question" }) });
    await expect(question).toContainText("你");
    await expect(page.getByRole("log")).toContainText("saved answer");
    if (attempt === 0) await page.reload();
  }
});
