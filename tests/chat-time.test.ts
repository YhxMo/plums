import { describe, expect, it } from "vitest";
import { formatTime } from "../src/agents/time";

describe("chat time labels", () => {
  const now = new Date(2026, 9, 19, 15, 30).getTime();
  it("shows the clock today and names yesterday", () => {
    expect(formatTime(new Date(2026, 9, 19, 9, 5).getTime(), now)).toBe(
      "09:05",
    );
    const yesterday = new Date(2026, 9, 18, 23, 59).getTime();
    expect(formatTime(yesterday, now)).toBe("昨天 23:59");
    expect(formatTime(yesterday, now, true)).toBe("昨天");
  });
  it("adds the date earlier this year and the year before that", () => {
    const earlier = new Date(2026, 2, 7, 8, 0).getTime();
    expect(formatTime(earlier, now)).toBe("3月7日 08:00");
    expect(formatTime(earlier, now, true)).toBe("3/7");
    const lastYear = new Date(2025, 11, 31, 20, 15).getTime();
    expect(formatTime(lastYear, now)).toBe("2025年12月31日 20:15");
    expect(formatTime(lastYear, now, true)).toBe("2025/12/31");
  });
});
