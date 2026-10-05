import { useState, useRef, useEffect, useId, type ReactNode } from "react";
export function Popover({
  label,
  trigger,
  children,
  disabled = false,
  className = "",
}: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false),
    root = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null),
    id = useId();
  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLElement>(".popover button:not(:disabled)")
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div
      className={`popover-anchor ${className}`}
      ref={root}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
        if (!open) return;
        const items = Array.from(
          root.current!.querySelectorAll<HTMLButtonElement>(
            ".popover button:not(:disabled)",
          ),
        );
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                  items.length;
          items[next]?.focus();
        }
        if (event.key === "Tab") setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        className={
          className === "usage" ? "usage-badge sm" : "ghost icon-button"
        }
        aria-label={label}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open && (
        <div
          className="popover"
          id={id}
          role="group"
          aria-label={label}
          onClick={(event) => {
            if ((event.target as Element).closest("button")) {
              setOpen(false);
              button.current?.focus();
            }
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
