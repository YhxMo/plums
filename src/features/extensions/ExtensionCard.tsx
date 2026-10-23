import type { ReactNode } from "react";
import { cn } from "cn";
import type { ExtensionCardModel } from "./controllers";
import { stateMessage } from "@/shell/messages";
import { StatusBadge } from "./StatusBadge";

export function ExtensionCard({
  extension,
  onSelect,
  actions,
  children,
}: {
  extension: Pick<
    ExtensionCardModel,
    "entry" | "manifest" | "state" | "selected" | "users"
  >;
  onSelect(): void;
  /** Buttons beside the status, such as enable or configure. */
  actions: ReactNode;
  children?: ReactNode;
}) {
  const { entry, manifest, state, users, selected: isSelected } = extension;
  const { id } = entry;
  return (
    <article
      key={id}
      data-extension-id={id}
      className={cn(
        "mb-2 cursor-pointer rounded-xl bg-card p-3.5 shadow-panel transition-[box-shadow,transform] duration-150 hover:shadow-raised max-md:px-4",
        isSelected && "shadow-raised ring-2 ring-brand/70 hover:shadow-raised",
      )}
      onClick={onSelect}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {/* data-slot keeps the plain-button look for extension DOM off it. */}
            <button
              type="button"
              data-slot="extension-title"
              className="min-w-0 truncate text-left text-[13px] font-semibold outline-none focus-visible:underline"
              aria-pressed={isSelected}
              onClick={onSelect}
            >
              {entry.label}
            </button>
            <StatusBadge status={state.status} />
          </div>
          <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
            <code>
              {id} · {manifest.version}
            </code>
            {users.map((group) =>
              group.users.length ? (
                <span key={group.owner} className="before:content-['·_']">
                  {group.users.length} 个 {group.kind} 在使用
                </span>
              ) : null,
            )}
          </p>
        </div>
        <div onClick={(event) => event.stopPropagation()}>{actions}</div>
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
    </article>
  );
}
