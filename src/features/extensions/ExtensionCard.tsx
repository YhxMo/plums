import type { ReactNode } from "react";
import { cn } from "cn";
import type { ExtensionCardModel } from "./controllers";
import { stateMessage } from "../../shell/messages";
import { StatusBadge } from "./StatusBadge";

export function ExtensionCard({
  extension,
  onSelect,
  children,
}: {
  extension: Pick<
    ExtensionCardModel,
    "entry" | "manifest" | "state" | "selected" | "users"
  >;
  onSelect(): void;
  children: ReactNode;
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
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="min-w-0 truncate text-left text-[13px] font-semibold outline-none focus-visible:underline"
          aria-pressed={isSelected}
          onClick={onSelect}
        >
          {entry.label}
        </button>
        <StatusBadge status={state.status} />
      </div>
      <p className="mt-1 mb-2.5 flex flex-wrap gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
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
      {state.error && (
        <p className="mb-2 text-xs text-destructive">{stateMessage(state)}</p>
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
