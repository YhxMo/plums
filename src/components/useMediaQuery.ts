import { useCallback, useMemo, useSyncExternalStore } from "react";

export function useMediaQuery(query: string) {
  const media = useMemo(() => matchMedia(query), [query]);
  const subscribe = useCallback(
    (listener: () => void) => {
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    [media],
  );
  const snapshot = useCallback(() => media.matches, [media]);
  return useSyncExternalStore(subscribe, snapshot);
}
