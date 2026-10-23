type PlatformHints = {
  userAgentData?: { platform?: string };
  platform?: string;
};

/**
 * Whether shortcuts use ⌘ rather than Ctrl. User-Agent Client Hints where the
 * engine has them; WebKit, and so the Mac app, reports `navigator.platform`.
 */
export function appleKeyboard(
  hints: PlatformHints = navigator as PlatformHints,
) {
  const platform = hints.userAgentData?.platform ?? hints.platform ?? "";
  return /^(?:mac|iphone|ipad|ios)/i.test(platform);
}
