import { useCallback, useEffect, useRef, useState } from "react";

/** Keys that scroll a focused log; typing in a field does not. */
const scrollKeys = new Set([
  " ",
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

/**
 * Keeps a scrolling log at its end while the person is there.
 *
 * After the design of assistant-ui's viewport auto-scroll (MIT): the browser's
 * own `scrollTo`, not an animated spring; a request to go to the end holds
 * until the end is reached, following content that grows meanwhile; only
 * the person scrolling up leaves the end, never content shrinking under
 * them; their wheel, touch, press or key cancels a request in flight. The
 * end allows a pixel, as WebKit scrolls in fractions on 2x screens.
 * use-stick-to-bottom's spring settled late and short of the end in WebKit
 * (stackblitz-labs/use-stick-to-bottom#9 and #32).
 */
export function useFollowBottom() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setAtBottom] = useState(true);
  const state = useRef({
    /** Stay at the end as content grows. */
    follow: true,
    /** A request to reach the end, until it is reached. */
    intent: null as ScrollBehavior | null,
    top: 0,
    height: 0,
  });
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "instant") => {
    const log = scrollRef.current;
    if (!log) return;
    Object.assign(state.current, { follow: true, intent: behavior });
    log.scrollTo({ top: log.scrollHeight, behavior });
  }, []);
  useEffect(() => {
    const log = scrollRef.current;
    const content = contentRef.current;
    if (!log || !content) return;
    const now = state.current;
    const atEnd = () =>
      log.scrollHeight - log.scrollTop - log.clientHeight <= 1 ||
      log.scrollHeight <= log.clientHeight;
    const onScroll = () => {
      const end = atEnd();
      const up = log.scrollTop < now.top && log.scrollHeight === now.height;
      // A line entering grew the log mid-way: aim at the new end.
      if (now.intent && !end && log.scrollHeight !== now.height)
        log.scrollTo({ top: log.scrollHeight, behavior: now.intent });
      if (end) Object.assign(now, { follow: true, intent: null });
      else if (up) Object.assign(now, { follow: false, intent: null });
      // While a request is on its way down, the log is not "away".
      if (end || !now.intent) setAtBottom(end);
      now.top = log.scrollTop;
      now.height = log.scrollHeight;
    };
    const onResize = () => {
      if (now.intent)
        log.scrollTo({ top: log.scrollHeight, behavior: now.intent });
      else if (now.follow)
        log.scrollTo({ top: log.scrollHeight, behavior: "instant" });
      onScroll();
    };
    const cancel = () => (now.intent = null);
    const onKey = (event: KeyboardEvent) => {
      if (scrollKeys.has(event.key)) cancel();
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(log);
    observer.observe(content);
    // Lines added or changed can move the end without resizing the content
    // box, as transforms of entering lines extend the scrollable area.
    const mutations = new MutationObserver(onResize);
    mutations.observe(content, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    log.addEventListener("scroll", onScroll, { passive: true });
    log.addEventListener("wheel", cancel, { passive: true });
    log.addEventListener("touchstart", cancel, { passive: true });
    log.addEventListener("pointerdown", cancel);
    log.addEventListener("keydown", onKey);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      log.removeEventListener("scroll", onScroll);
      log.removeEventListener("wheel", cancel);
      log.removeEventListener("touchstart", cancel);
      log.removeEventListener("pointerdown", cancel);
      log.removeEventListener("keydown", onKey);
    };
  }, []);
  return { scrollRef, contentRef, isAtBottom, scrollToBottom };
}
