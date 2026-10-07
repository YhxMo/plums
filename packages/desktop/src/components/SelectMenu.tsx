import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon.js";

export function SelectMenu({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className = "",
  testId,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; leading?: ReactNode }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const selected = options.find((option) => option.value === value);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  useEffect(() => {
    if (!open) return;
    items.current[selectedIndex]?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const blur = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("blur", blur);
    };
  }, [open, selectedIndex]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div
      className={`select-menu ${className}`}
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          event.preventDefault();
          close();
        } else if (event.key === "Tab" && open) {
          close();
        } else if (
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          if (disabled || !options.length) return;
          event.preventDefault();
          if (!open) {
            setOpen(true);
            return;
          }
          const at = items.current.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? options.length - 1
                : (at + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
                  options.length;
          items.current[next]?.focus();
          items.current[next]?.scrollIntoView({ block: "nearest" });
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="select-menu-trigger"
        data-testid={testId}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        title={selected?.label}
        onClick={() => setOpen(!open)}
      >
        {selected?.leading}
        <span className="select-menu-label">{selected?.label ?? "请选择"}</span>
        <Icon name="down" size={14} />
      </button>
      {open && (
        <div
          id={id}
          className="select-menu-list"
          role="listbox"
          aria-label={label}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              ref={(item) => {
                items.current[index] = item;
              }}
              type="button"
              role="option"
              tabIndex={-1}
              aria-label={option.label}
              aria-selected={option.value === value}
              title={option.label}
              onClick={() => {
                close();
                if (option.value !== value) onChange(option.value);
              }}
            >
              {option.leading}
              <span className="select-menu-label">{option.label}</span>
              <span className="select-menu-check" aria-hidden="true">
                {option.value === value && <Icon name="check" size={16} />}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
