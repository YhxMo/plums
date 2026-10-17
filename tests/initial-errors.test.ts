import { expect, it } from "vitest";
import { initialErrorFor } from "../src/shell/useOperations";

it("keeps a single failure message readable", () => {
  expect(
    initialErrorFor({
      compositionErrors: [],
      platformErrors: [],
      failedImports: { external: "认证失败" },
    }),
  ).toBe("有扩展加载失败，请在扩展管理重试或移除失效路径。");
});

it("combines composition, platform and import failures instead of hiding one", () => {
  const message = initialErrorFor({
    compositionErrors: ["组合配置无效"],
    platformErrors: ["文档服务初始化失败：ipc unavailable"],
    failedImports: { external: "认证失败" },
  });
  expect(message).toContain("组合未完整恢复：组合配置无效。原配置已保留。");
  expect(message).toContain("文档服务初始化失败：ipc unavailable。");
  expect(message).not.toContain("平台服务初始化失败：文档服务");
  expect(message).toContain("有扩展加载失败");
});
