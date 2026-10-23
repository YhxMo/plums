import { expect, it } from "vitest";
import { appleKeyboard } from "../src/components/keyboard";

it("prefers User-Agent Client Hints, then the platform string", () => {
  expect(appleKeyboard({ userAgentData: { platform: "macOS" } })).toBe(true);
  expect(
    appleKeyboard({
      userAgentData: { platform: "Windows" },
      platform: "MacIntel",
    }),
  ).toBe(false);
  // WebKit, and so the Mac app, has no userAgentData.
  expect(appleKeyboard({ platform: "MacIntel" })).toBe(true);
  expect(appleKeyboard({ platform: "iPad" })).toBe(true);
  expect(appleKeyboard({ platform: "Win32" })).toBe(false);
  expect(appleKeyboard({ platform: "Linux armv8l" })).toBe(false);
  expect(appleKeyboard({})).toBe(false);
});
