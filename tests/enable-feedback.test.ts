import { expect, it } from "vitest";
import { waitingNotice } from "../src/features/extensions/enable-feedback";

it("says nothing when the extension reached the active state", () => {
  expect(waitingNotice("active")).toBeNull();
});

it("explains a waiting extension with its translated host reason", () => {
  expect(waitingNotice("waiting", "依赖暂不可用：text.transform@1")).toBe(
    "扩展尚未运行：依赖暂不可用：text.transform@1。",
  );
});

it("keeps translated sentence punctuation intact", () => {
  expect(waitingNotice("waiting", "扩展存在循环依赖。")).toBe(
    "扩展尚未运行：扩展存在循环依赖。",
  );
});

it("falls back to a generic reason without host diagnostics", () => {
  expect(waitingNotice("failed")).toBe("扩展尚未运行：等待条件。");
});
