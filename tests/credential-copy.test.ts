import { expect, it } from "vitest";
import { resultMessage } from "../src/features/extensions/credential-copy";

it("keeps successful and cancelled credentials copy unchanged", () => {
  expect(resultMessage({ status: "saved" }, "已保存。")).toBe("已保存。");
  expect(resultMessage({ status: "cancelled" }, "已保存。")).toBe(
    "已取消，保留原连接记录。",
  );
});

it("keeps unknown receipts distinct from a proven non-attempt", () => {
  expect(resultMessage({ status: "unknown" }, "已保存。")).toContain("待核对");
  expect(
    resultMessage({ status: "rejected", reason: "unavailable" }, "已保存。"),
  ).toContain("操作未执行");
});

it("falls back for unrecognized rejected reasons", () => {
  expect(
    resultMessage({ status: "rejected", reason: "future-reason" }, "已保存。"),
  ).toBe("操作未完成，请核对连接记录后重试。");
});
