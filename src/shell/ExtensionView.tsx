import { useLayoutEffect, useRef, useState } from "react";
import type { Host } from "@modules/extension-host/host";

/** Mount the same public view contract inside a shell-owned dialog. */
export function ExtensionView({
  host,
  id,
  generation,
  onClose,
}: {
  host: Host;
  id: string;
  generation: number;
  /** Closes the dialog showing it; the view gets it as `context.close`. */
  onClose?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  // Mounted once, the view still closes the dialog as it now stands.
  const closing = useRef(onClose);
  useLayoutEffect(() => {
    closing.current = onClose;
  });
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    setError("");
    try {
      const close = host.mountView(
        id,
        root.current!,
        closing.current ? { close: () => closing.current?.() } : {},
      );
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
