import { useLayoutEffect, useRef, useState } from "react";
import type { Host } from "@modules/extension-host/host";

/** Mount the same public view contract inside a shell-owned dialog. */
export function ExtensionView({
  host,
  id,
  generation,
}: {
  host: Host;
  id: string;
  generation: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    setError("");
    try {
      const close = host.mountView(id, root.current!);
      return () => {
        try {
          const pending = close();
          if (pending) void pending.catch((e) => setError(String(e)));
        } catch (e) {
          setError(String(e));
        }
      };
    } catch (e) {
      setError(String(e));
    }
  }, [host, id, generation]);
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div ref={root} />
    </>
  );
}
