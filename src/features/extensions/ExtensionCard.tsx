import type { ReactNode } from "react";
import { cn } from "cn";
import type { ExtensionCardModel } from "./controllers";
import { stateMessage } from "@/shell/messages";
import { StatusBadge } from "./StatusBadge";

/** States worth a word in the list; running and switched off show only the switch. */
const NOTEWORTHY = new Set(["failed", "cleanup-failed", "waiting", "stopping"]);

/**
 * One extension in the list: its name, the first line of what it is for,
 * and its switch. Everything else is in its details.
 */
export function ExtensionCard({
  extension,
  onSelect,
  toggle,
  children,
}: {
  extension: Pick<
    ExtensionCardModel,
    "entry" | "manifest" | "state" | "selected"
  >;
  onSelect(): void;
  /** The switch that starts or stops it. */
  toggle: ReactNode;
  children?: ReactNode;
}) {
  const { entry, manifest, state, selected: isSelected } = extension;
  const { id } = entry;
  const summary = manifest.description?.trim().split("\n")[0];
  return (
    <li
      key={id}
      data-extension-id={id}
      data-selected={isSelected}
      // The right padding sits on each child, so the switch's wider hit
      // area stays inside the row instead of overflowing it.
      className={cn(
        "cursor-pointer rounded-md py-2.5 pl-3 *:pr-3 hover:bg-muted/60",
        isSelected && "bg-muted hover:bg-muted",
      )}
      onClick={onSelect}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {/* data-slot keeps the plain-button look for extension DOM off it. */}
            <button
              type="button"
              data-slot="extension-title"
              className="min-w-0 truncate text-left text-sm font-medium outline-none focus-visible:underline"
              aria-pressed={isSelected}
              onClick={onSelect}
            >
              {entry.label}
            </button>
            {NOTEWORTHY.has(state.status) && (
              <StatusBadge status={state.status} />
            )}
          </div>
          {summary && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {summary}
            </p>
          )}
        </div>
        {toggle}
      </div>
      {state.error && (
        <p className="mt-2 text-xs text-destructive">{stateMessage(state)}</p>
      )}
      {children}
      {state.status === "cleanup-failed" && (
        <p className="mt-2 text-xs text-destructive">
          请重新启动应用以恢复此扩展。
        </p>
      )}
    </li>
  );
}
