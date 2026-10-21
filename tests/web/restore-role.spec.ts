import { expect, test } from "@playwright/test";
import { manage } from "./helpers";

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

test("invalid saved role fails only the Agent provider and keeps persisted bytes", async ({
  page,
}) => {
  const original = state(["user"]);
  await page.addInitScript((raw) => {
    if (!localStorage.getItem("plums:m1:host.shell"))
      localStorage.setItem("plums:m1:host.shell", raw);
  }, original);
  await page.goto("/");
  const alert = page.getByRole("alert").filter({ hasText: "扩展启动失败" });
  await expect(alert).toContainText("agents.local");
  await expect(alert).toContainText("会话配置损坏");
  await manage(page);
  await expect(
    page
      .locator("#extension-manager article")
      .filter({ hasText: "Agent 核心" }),
  ).toContainText("会话配置损坏");
  expect(
    await page.evaluate(() => [
      localStorage.getItem("plums:m1:host.shell"),
      localStorage.getItem("plums:m1:extension.agents.local"),
    ]),
  ).toEqual([original, null]);
});

test("legacy shell roles move to the Agent provider's own state once", async ({
  page,
}) => {
  await page.addInitScript((raw) => {
    if (!localStorage.getItem("plums:m1:host.shell"))
      localStorage.setItem("plums:m1:host.shell", raw);
  }, state("user"));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "与 RestoreRole 交互", exact: true }),
  ).toBeVisible();
  const stored = () =>
    page.evaluate(() => ({
      shell: JSON.parse(localStorage.getItem("plums:m1:host.shell")!).value,
      own: JSON.parse(localStorage.getItem("plums:m1:extension.agents.local")!),
    }));
  const first = await stored();
  expect(first.shell).not.toHaveProperty("agents");
  expect(first.own.value.agents[0].name).toBe("RestoreRole");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "与 RestoreRole 交互", exact: true }),
  ).toBeVisible();
  expect((await stored()).own.revision).toBe(first.own.revision);
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
