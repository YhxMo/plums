import { expect, it } from "vitest";
import { selectionAfterFailure } from "../src/shell/selection";

it("keeps the failed selection when no previous working view exists", () => {
  expect(selectionAfterFailure("broken", "broken", undefined)).toBe("broken");
});

it("returns to the last working view after a failure", () => {
  expect(selectionAfterFailure("broken", "broken", "agents")).toBe("agents");
});

it("does not change another selected view", () => {
  expect(selectionAfterFailure("agents", "board", "agents")).toBe("agents");
});
