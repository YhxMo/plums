import { expect, test } from "@playwright/test";
import { addAgent, firstSessionMessageCount } from "./helpers";

for (const webkit of [false, true]) {
  test(`IME confirmation does not send with ${webkit ? "WebKit keyCode 229" : "isComposing"}`, async ({
    page,
  }) => {
    await page.goto("/");
    await addAgent(page, "输入验收");
    const input = page.getByRole("textbox", { name: "消息", exact: true });
    await input.fill("选词草稿");
    // WebKit can end composition before the confirming Enter keydown.
    // Native IME acceptance remains separate from this event regression.
    const consumed = await input.evaluate((node, webkit) => {
      node.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      if (webkit)
        node.dispatchEvent(
          new CompositionEvent("compositionend", { bubbles: true }),
        );
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
        isComposing: !webkit,
        keyCode: webkit ? 229 : 13,
      });
      node.dispatchEvent(event);
      if (!webkit)
        node.dispatchEvent(
          new CompositionEvent("compositionend", { bubbles: true }),
        );
      return event.defaultPrevented;
    }, webkit);
    expect(consumed).toBe(false);
    await expect(input).toHaveValue("选词草稿");
    expect(await firstSessionMessageCount(page, "输入验收")).toBe(0);
    await input.press("Shift+Enter");
    await expect(input).toHaveValue("选词草稿\n");
    await input.press("Enter");
    await expect(page.getByRole("log")).toContainText("echo-a｜第 1 轮");
    await expect(input).toHaveValue("");
    expect(await firstSessionMessageCount(page, "输入验收")).toBe(2);
  });

  test(`IME Escape keeps the dialog open with ${webkit ? "WebKit keyCode 229" : "isComposing"}`, async ({
    page,
  }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", {
      name: "从头添加 Agent",
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole("dialog", {
      name: "添加 Agent",
      exact: true,
    });
    const input = dialog.getByRole("textbox", { name: "名称", exact: true });
    await input.fill("保留的草稿");
    const consumed = await input.evaluate((node, webkit) => {
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
        isComposing: !webkit,
        keyCode: webkit ? 229 : 27,
      });
      node.dispatchEvent(event);
      return event.defaultPrevented;
    }, webkit);
    expect(consumed).toBe(false);
    await expect(dialog).toBeVisible();
    await expect(input).toHaveValue("保留的草稿");
    await expect(input).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}
