import { useCallback, useEffect, useRef, useState } from "react";
import { useManagerStore } from "../state/ManagerStore.js";

export function useAction(scope = "") {
  const { load } = useManagerStore();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  const mounted = useRef(true);
  const identity = useRef({ scope });
  if (identity.current.scope !== scope) identity.current = { scope };
  useEffect(() => {
    active.current = false;
    setPending(false);
    setError("");
  }, [scope]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const clear = useCallback(() => setError(""), []);
  const run = useCallback(
    async (fn: () => Promise<unknown>, refresh = true) => {
      if (active.current) return false;
      const owner = identity.current;
      const current = () => mounted.current && owner === identity.current;
      active.current = true;
      setPending(true);
      setError("");
      try {
        await fn();
        // A committed operation must not look failed merely because refreshing failed.
        if (refresh && mounted.current) await load().catch(() => {});
        return current();
      } catch (failure) {
        if (current()) {
          const message = (failure as { message?: unknown } | null)?.message;
          setError(typeof message === "string" ? message : "操作未完成。");
        }
        return false;
      } finally {
        if (current()) {
          active.current = false;
          setPending(false);
        }
      }
    },
    [load],
  );
  return { run, pending, error, clear };
}
