import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icon";
import s from "./Select.module.css";

export type SelectOption = {
  value: string;
  label: string;
  /** Second line in the list, such as which service a model belongs to. */
  description?: string;
  /** Heading the option is listed under; consecutive options share one. */
  group?: string;
};

/**
 * Single-choice picker styled like the app's menus (select-only combobox).
 * Focus stays on the button; arrows, Home/End, Enter/Space and Escape work
 * as in a native select, and Escape closes only the list.
 */
export function Select({
  label,
  value,
  options,
  onChange,
  disabled,
  placeholder = "请选择",
}: {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = options.findIndex((option) => option.value === value);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const show = () => {
    setActive(Math.max(selected, 0));
    setOpen(true);
  };
  const choose = (index: number) => {
    setOpen(false);
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    const moves: Record<string, number> = {
      ArrowDown: Math.min(active + 1, last),
      ArrowUp: Math.max(active - 1, 0),
      Home: 0,
      End: last,
    };
    if (e.key in moves) {
      e.preventDefault();
      setActive(moves[e.key]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      // Keep the surrounding dialog open.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "Tab") setOpen(false);
  };
  const current = options[selected];
  return (
    <div className={s.select} ref={root}>
      <button
        type="button"
        role="combobox"
        className={s.trigger}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span className={current ? undefined : s.placeholder}>
          {current?.label ?? placeholder}
        </span>
        <Icon name="down" size={16} />
      </button>
      {open && (
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className={s.list}
          // System Back dispatches Escape to the open list.
          onKeyDown={onKeyDown}
        >
          {groups(options).map(({ group, items }) => {
            const rows = items.map(({ option, index }) => (
              <div
                key={option.value}
                id={`${id}-${index}`}
                role="option"
                aria-selected={index === selected}
                className={s.option}
                data-active={index === active || undefined}
                onPointerDown={(e) => e.preventDefault()}
                onPointerEnter={() => setActive(index)}
                onClick={() => choose(index)}
              >
                <span className={s.text}>
                  <span>{option.label}</span>
                  {option.description && (
                    <span className={s.description}>{option.description}</span>
                  )}
                </span>
                {index === selected && <Icon name="check" size={16} />}
              </div>
            ));
            return group === undefined ? (
              rows
            ) : (
              <div
                key={`group-${items[0].index}`}
                role="group"
                aria-label={group}
              >
                <div className={s.heading} aria-hidden>
                  {group}
                </div>
                {rows}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function groups(options: readonly SelectOption[]) {
  const result: {
    group?: string;
    items: { option: SelectOption; index: number }[];
  }[] = [];
  options.forEach((option, index) => {
    const last = result.at(-1);
    if (last && last.group === option.group) last.items.push({ option, index });
    else result.push({ group: option.group, items: [{ option, index }] });
  });
  return result;
}
