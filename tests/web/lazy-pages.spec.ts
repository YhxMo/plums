import { expect, test } from "@playwright/test";
import { manage } from "./helpers";

// The development server serves each source module as its own request, so a
// module absent from the requests did not run at startup. Model connections
// are covered where its native setup lives (model-connection-recovery.spec).
test("extension management loads only when first opened", async ({ page }) => {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(new URL(request.url()).pathname));
  const requested = () =>
    urls.includes("/src/features/extensions/ExtensionManager.tsx");
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "应用菜单", exact: true }),
  ).toBeVisible();
  expect(requested()).toBe(false);

  await manage(page);
  await expect(
    page.getByRole("complementary", { name: "扩展管理", exact: true }),
  ).toBeVisible();
  expect(requested()).toBe(true);
});
