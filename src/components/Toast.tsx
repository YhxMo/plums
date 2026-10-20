import { useEffect, useEffectEvent, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./Toast.module.css";

const FADE = 300;
/** Long enough to read: about 80 ms per character, 3–10 s. */
const readingTime = (text: string) => Math.min(10000, 3000 + text.length * 80);

/** The open modal dialog, if any: the rest of the page is inert under it. */
const topLayer = () =>
  [...document.querySelectorAll("dialog")]
    .filter((dialog) => dialog.matches(":modal"))
    .at(-1) ?? null;

/**
 * A passing message that fades out on its own; pointing at it holds it.
 * It shows inside an open modal dialog so it is not hidden beneath it.
 * Give it `key={message}` so a new message starts a fresh timer.
 */
export function Toast({
  message,
  error = false,
  onDone,
}: {
  message: string;
  error?: boolean;
  onDone: () => void;
}) {
  const finish = useEffectEvent(onDone);
  const [held, setHeld] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // After commit: a dialog closing in the same update is gone by then.
  const [layer, setLayer] = useState<HTMLDialogElement | null>(null);
  useLayoutEffect(() => setLayer(topLayer()), []);
  useEffect(() => {
    if (!layer) return;
    // Outlive the dialog: move back out when it closes.
    const out = () => setLayer(topLayer());
    layer.addEventListener("close", out);
    return () => layer.removeEventListener("close", out);
  }, [layer]);
  useEffect(() => {
    if (held) return;
    const time = readingTime(message);
    const fade = setTimeout(() => setLeaving(true), time);
    const end = setTimeout(() => finish(), time + FADE);
    return () => {
      clearTimeout(fade);
      clearTimeout(end);
    };
  }, [message, held]);
  const toast = (
    <div
      className={`${styles.toast} ${error ? styles.error : ""}`}
      role={error ? "alert" : "status"}
      data-leaving={leaving}
      onPointerEnter={() => {
        setHeld(true);
        setLeaving(false);
      }}
      onPointerLeave={() => setHeld(false)}
    >
      {message}
    </div>
  );
  return layer ? createPortal(toast, layer) : toast;
}

/** The latest action's error, else its notice; done clears both. */
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
  if (!message) return null;
  return (
    <Toast key={message} message={message} error={!!error} onDone={onDone} />
  );
}
