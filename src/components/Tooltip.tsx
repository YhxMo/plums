import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "./Icon";
import styles from "./Tooltip.module.css";

const DELAY = 400;
const GAP = 6;
const EDGE = 8;

/**
 * A short label shown beside its trigger: after a pause under the pointer,
 * at once on keyboard focus. Escape, a press or leaving hides it; touch does
 * not show it, since a tap already acts. `toggle` also opens it on a press,
 * for info buttons that do nothing else.
 */
export function Tooltip({
  label,
  children,
  toggle = false,
}: {
  label: string;
  children: ReactNode;
  toggle?: boolean;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [open, setOpen] = useState(false);
  const show = (delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Close the tooltip first, not the menu or dialog around it.
        event.preventDefault();
        event.stopPropagation();
        hide();
      }
    };
    const away = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) hide();
    };
    document.addEventListener("keydown", escape, true);
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open]);
  useLayoutEffect(() => {
    const target = anchor.current?.firstElementChild;
    const tip = bubble.current;
    if (!open || !target || !tip) return;
    const rect = target.getBoundingClientRect();
    const { width, height } = tip.getBoundingClientRect();
    const below = rect.bottom + GAP + height <= innerHeight - EDGE;
    const left = Math.min(
      Math.max(EDGE, rect.left + rect.width / 2 - width / 2),
      innerWidth - EDGE - width,
    );
    tip.style.left = `${Math.max(EDGE, left)}px`;
    tip.style.top = `${below ? rect.bottom + GAP : rect.top - GAP - height}px`;
    tip.dataset.ready = "true";
  });
  return (
    <span
      ref={anchor}
      className={styles.anchor}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") show(DELAY);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "touch" || !toggle) hide();
      }}
      onPointerDown={() => {
        if (!toggle) hide();
      }}
      onClick={() => {
        if (toggle) {
          clearTimeout(timer.current);
          setOpen((shown) => !shown);
        }
      }}
      onFocus={(event) => {
        if (event.target.matches(":focus-visible")) show(0);
      }}
      onBlur={hide}
    >
      {children}
      {open && (
        <span ref={bubble} role="tooltip" className={styles.bubble}>
          {label}
        </span>
      )}
    </span>
  );
}

/** An info button whose explanation shows in a tooltip. */
export function InfoTip({ label, text }: { label: string; text: string }) {
  const id = useId();
  return (
    <Tooltip label={text} toggle>
      <button
        type="button"
        className={styles.info}
        aria-label={`${label}说明`}
        aria-describedby={id}
      >
        <Icon name="info" size={14} />
        <span id={id} hidden>
          {text}
        </span>
      </button>
    </Tooltip>
  );
}
