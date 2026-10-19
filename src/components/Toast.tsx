import { useEffect, useEffectEvent, useState } from "react";
import styles from "./Toast.module.css";

const FADE = 300;
/** Long enough to read: about 80 ms per character, 3–10 s. */
const readingTime = (text: string) => Math.min(10000, 3000 + text.length * 80);

/**
 * A passing message that fades out on its own; pointing at it holds it.
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
  return (
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
}
