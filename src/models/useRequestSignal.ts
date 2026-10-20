import { useEffect, useRef } from "react";

/** One model-page request at a time; closing its view aborts it as well. */
export function useRequestSignal() {
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);
  return () => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    return AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]);
  };
}
