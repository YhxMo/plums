import { useEffect, useEffectEvent, useRef } from "react";
import { toast } from "sonner";
import { useToastLayers } from "./toast-layers";

/** Long enough to read: about 80 ms per character, 3–10 s. */
const readingTime = (text: string) => Math.min(10000, 3000 + text.length * 80);

/**
 * Shows the latest action's error, else its notice, as a toast that fades on
 * its own (pointing at it holds it); a new message replaces the old one and
 * `onDone` clears both once it times out or is dismissed. A message still
 * showing follows the innermost open dialog, and moves back to the page when
 * that dialog closes.
 */
export function ActionToast({
  error,
  notice,
  onDone,
}: {
  error: string;
  notice: string;
  onDone: () => void;
}) {
  const message = error || notice;
  const done = useEffectEvent(onDone);
  const toasterId = useToastLayers((state) => state.layers.at(-1));
  // The toast on screen; moving or clearing it is not the person's dismissal.
  const shown = useRef<{ id: string; silence: () => void } | null>(null);
  const hide = () => {
    shown.current?.silence();
    if (shown.current) toast.dismiss(shown.current.id);
    shown.current = null;
  };
  useEffect(() => {
    const id = `action:${toasterId ?? "page"}`;
    if (!message || shown.current?.id !== id) hide();
    if (!message) return;
    let silent = false;
    const finish = () => {
      if (!silent) done();
    };
    toast(<span role={error ? "alert" : "status"}>{message}</span>, {
      id,
      toasterId,
      duration: readingTime(message),
      className: error ? "text-destructive!" : undefined,
      onAutoClose: finish,
      onDismiss: finish,
    });
    shown.current = { id, silence: () => (silent = true) };
  }, [message, error, toasterId]);
  useEffect(() => hide, []);
  return null;
}
