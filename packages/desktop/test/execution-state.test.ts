import { expect, it } from "vitest";
import {
  executionRecords,
  executionGuidance,
} from "../src/shared/execution-state.js";

it("keeps every stage, sorts by last arrival and does not conflate outcome and execution state", () => {
  const events = [
    {
      callId: "first",
      timestamp: "2026-10-11T00:00:00Z",
      phase: "allow",
      executionState: "not_started",
    },
    {
      callId: "second",
      timestamp: "2026-10-11T00:00:01Z",
      phase: "result",
      executionState: "unknown",
    },
    {
      callId: "first",
      timestamp: "2026-10-11T00:00:02Z",
      phase: "result",
      outcome: "failed",
      executionState: "completed",
    },
    null,
    3,
    { callId: "bad" },
  ];
  const records = executionRecords(events, 1);
  expect(records).toHaveLength(1);
  expect(records[0]).toEqual([events[0], events[2]]);
  expect(records[0]!.at(-1)).toMatchObject({
    outcome: "failed",
    executionState: "completed",
  });
  expect(executionGuidance.completed.next).toContain("请勿自动重试");
  expect(executionGuidance.unknown.next).toContain("不会回滚");
  expect(executionGuidance.not_started.next).toContain("明确发起重试");
});
