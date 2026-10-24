import { useEffect, useEffectEvent, useRef } from "react";
import { toast } from "sonner";
import { useToastLayers } from "./toast-layers";

/** Long enough to read: about 80 ms per character, 3–10 s. */
const readingTime = (text: string) => Math.min(10000, 3000 + text.length * 80);
/** A notice with an action, such as 撤销, stays long enough to reach it. */
const ACTION_TIME = 8000;
export type ToastAction = { label: string; onClick: () => void };

/**
 * Shows the latest action's error, else its notice, as a toast that fades on
 * its own (pointing at it holds it); a new message replaces the old one and
 * `onDone` clears both once it times out or is dismissed. A message still
 * showing follows the innermost open dialog, and moves back to the page when
 * that dialog closes. A notice may carry one action button.
 */
export function ActionToast({
  error,
  notice,
  action,
  onDone,
}: {
  error: string;
  notice: string;
  /** Offered with the notice only; an error replaces both. */
  action?: ToastAction;
  onDone: () => void;
}) {
  const message = error || notice;
  const done = useEffectEvent(onDone);
  // Keyed by its label, so a new callback each render keeps the toast.
  const label = !error && message ? action?.label : undefined;
  const choose = useEffectEvent(() => action?.onClick());
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
      duration: label
        ? Math.max(ACTION_TIME, readingTime(message))
        : readingTime(message),
      className: error ? "text-destructive!" : undefined,
      action: label && (
        <button
          type="button"
          className="ml-auto shrink-0 rounded-md px-2 py-1 text-[13px] font-semibold text-brand-text hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          // A click leaves focus where it was: WebKit would otherwise focus
          // the toast, and the toaster would later pull focus back from
          // whatever the person moved on to.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            // The action ends the notice; it is not a dismissal to report.
            silent = true;
            choose();
          }}
        >
          {label}
        </button>
      ),
      onAutoClose: finish,
      onDismiss: finish,
    });
    shown.current = { id, silence: () => (silent = true) };
  }, [message, error, toasterId, label]);
  useEffect(() => hide, []);
  return null;
}
