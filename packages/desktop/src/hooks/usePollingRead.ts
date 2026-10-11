import { useCallback, useEffect, useRef } from "react";
import { LatestRead } from "../shared/latest-read.js";

export function usePollingRead<Value>({
  method,
  instanceId,
  revision,
  enabled = true,
  receive,
  delay,
  onError,
}: {
  method: string;
  instanceId: string;
  revision: unknown;
  enabled?: boolean;
  receive: (value: Value) => void;
  delay: (value: Value) => number;
  onError: () => void;
}) {
  const controller = useRef<{
    refresh: () => Promise<unknown>;
    pause: () => void;
    resume: () => Promise<unknown>;
  }>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let active = true,
      paused = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    const schedule = (ms: number) => {
      clear();
      if (active && !paused && !document.hidden)
        timer = setTimeout(() => void refresh(), ms);
    };
    const queue = new LatestRead<void, void>(async (_, current) => {
      try {
        const value = (await window.manager.call(method, {
          instanceId,
        })) as Value;
        if (!active || paused || !current()) return;
        receive(value);
        schedule(delay(value));
      } catch {
        if (!active || paused || !current()) return;
        onError();
        schedule(10_000);
      }
    });
    const refresh = () => {
      clear();
      return active && !paused ? queue.request() : Promise.resolve();
    };
    controller.current = {
      refresh,
      pause: () => {
        paused = true;
        clear();
        queue.invalidate();
      },
      resume: () => {
        paused = false;
        return refresh();
      },
    };
    const visibility = () => {
      clear();
      queue.invalidate();
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visibility);
    if (!document.hidden) void refresh();
    return () => {
      active = false;
      clear();
      queue.invalidate();
      controller.current = undefined;
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [method, instanceId, revision, enabled]);
  const refresh = useCallback(
    () => controller.current?.refresh() ?? Promise.resolve(),
    [],
  );
  // Capture the current reader so completion in an old Agent cannot refresh a new one.
  const pause = useCallback(() => {
    const current = controller.current;
    current?.pause();
    return () => current?.resume() ?? Promise.resolve();
  }, []);
  return { refresh, pause };
}
