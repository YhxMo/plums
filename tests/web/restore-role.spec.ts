import { expect, test } from "@playwright/test";
import { closeDetails, extensionDetail, manage } from "./helpers";

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
    if (!localStorage.getItem("plums:host.shell"))
      localStorage.setItem("plums:host.shell", raw);
  }, original);
  await page.goto("/");
  const alert = page.getByRole("alert").filter({ hasText: "扩展启动失败" });
  await expect(alert).toContainText("agents.local");
  await expect(alert).toContainText("会话配置损坏");
  await manage(page);
  const card = page.locator(
    '#extension-manager [data-extension-id="agents.local"]',
  );
  await expect(card).toContainText("激活失败");
  // The card names the state; its details give the reason.
  await expect(await extensionDetail(page, card)).toContainText("会话配置损坏");
  await closeDetails(page);
  expect(
    await page.evaluate(() => [
      localStorage.getItem("plums:host.shell"),
      localStorage.getItem("plums:extension.agents.local"),
    ]),
  ).toEqual([original, null]);
});

test("legacy shell roles move to the Agent provider's own state once", async ({
  page,
}) => {
  await page.addInitScript((raw) => {
    if (!localStorage.getItem("plums:host.shell"))
      localStorage.setItem("plums:host.shell", raw);
  }, state("user"));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "RestoreRole", exact: true }),
  ).toBeVisible();
  const stored = () =>
    page.evaluate(() => ({
      shell: JSON.parse(localStorage.getItem("plums:host.shell")!).value,
      own: JSON.parse(localStorage.getItem("plums:extension.agents.local")!),
    }));
  const first = await stored();
  expect(first.shell).not.toHaveProperty("agents");
  expect(first.own.value.agents[0].name).toBe("RestoreRole");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "RestoreRole", exact: true }),
  ).toBeVisible();
  expect((await stored()).own.revision).toBe(first.own.revision);
});

test("valid saved roles restore with correct attribution after reload", async ({
  page,
}) => {
  await page.addInitScript((raw) => {
    if (!localStorage.getItem("plums:host.shell"))
      localStorage.setItem("plums:host.shell", raw);
  }, state("user"));
  await page.goto("/");
  for (let attempt = 0; attempt < 2; attempt++) {
    await page
      .getByRole("button", { name: "RestoreRole", exact: true })
      .click();
    const question = page
      .getByRole("log")
      .locator('[data-slot="context-menu-trigger"]')
      .filter({ hasText: /^saved question$/ })
      // The bubble sits in a box that holds its width, inside the row.
      .locator("xpath=../..");
    await expect(question.locator(":scope > span")).toHaveText("你：");
    const answer = page
      .getByRole("log")
      .locator('[data-slot="context-menu-trigger"]')
      .filter({ hasText: /^saved answer$/ })
      // The bubble sits in a box that holds its width, inside the row.
      .locator("xpath=../..");
    await expect(answer.locator(":scope > span")).toHaveText("RestoreRole：");
    if (attempt === 0) await page.reload();
  }
});
