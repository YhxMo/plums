import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
export function SettingsMenu({
  onChoose,
}: {
  onChoose: (
    action: "extensions" | "roles" | "settings" | "diagnostics" | "about",
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div className="settings-menu" ref={root}>
      <button
        ref={trigger}
        className="icon-button"
        aria-label="应用菜单"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="应用菜单"
          className="menu-popup"
          onKeyDown={(e) => {
            const items = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]"),
            );
            const index = items.indexOf(document.activeElement as HTMLElement);
            if (e.key === "Escape") {
              setOpen(false);
              trigger.current?.focus();
            } else if (
              ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)
            ) {
              e.preventDefault();
              items[
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? items.length - 1
                    : (index + (e.key === "ArrowUp" ? -1 : 1) + items.length) %
                      items.length
              ]?.focus();
            }
          }}
        >
          {(
            [
              ["extensions", "puzzle", "扩展管理"],
              ["roles", "card", "角色卡设置"],
              ["settings", "settings", "应用设置"],
              ["diagnostics", "code", "诊断工具"],
              ["about", "info", "关于 Plums"],
            ] as const
          ).map(([action, icon, label]) => (
            <button
              key={action}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
                onChoose(action);
              }}
            >
              <Icon name={icon} size={18} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
