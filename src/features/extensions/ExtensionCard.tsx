import type { ReactNode } from "react";
import type { ExtensionCardModel } from "./controllers";
import { StatusBadge } from "./StatusBadge";

/** States worth a word on the card; running and switched off show only the switch. */
const NOTEWORTHY = new Set(["failed", "cleanup-failed", "waiting", "stopping"]);

/** "2 个 Agent：甲、乙" per kind of user, each user once, the count first. */
function usersLine(groups: ExtensionCardModel["users"]) {
  const byKind = new Map<string, Map<string, string>>();
  for (const group of groups) {
    const names = byKind.get(group.kind) ?? new Map<string, string>();
    for (const user of group.users) names.set(user.id, user.label);
    if (names.size) byKind.set(group.kind, names);
  }
  return [...byKind]
    .map(
      ([kind, names]) =>
        `${names.size} 个 ${kind}：${[...names.values()].join("、")}`,
    )
    .join("；");
}

/**
 * One extension on the page: its name, what it is for in two lines and its
 * switch. Pressing the card opens the details, where everything else is.
 */
export function ExtensionCard({
  extension,
  onOpen,
  toggle,
}: {
  extension: Pick<ExtensionCardModel, "entry" | "manifest" | "state" | "users">;
  onOpen(source: HTMLElement): void;
  /** The switch that starts or stops it. */
  toggle: ReactNode;
}) {
  const { entry, manifest, state, users } = extension;
  const summary = manifest.description?.trim();
  const usedBy = usersLine(users);
  return (
    // The right padding sits on each child, so the switch's wider hit
    // area stays inside the card instead of overflowing it.
    <li
      data-extension-id={entry.id}
      className="flex min-h-24 cursor-pointer flex-col gap-1 rounded-lg border py-3 pl-3 *:pr-3 hover:bg-muted/60 has-[[data-slot=extension-title]:focus-visible]:ring-3 has-[[data-slot=extension-title]:focus-visible]:ring-ring/50"
      // Pointer users press anywhere; the title is the control for keyboards.
      onClick={(event) =>
        onOpen(
          event.currentTarget.querySelector<HTMLElement>(
            "[data-slot=extension-title]",
          )!,
        )
      }
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          data-slot="extension-title"
          aria-haspopup="dialog"
          className="min-w-0 flex-1 truncate text-left text-sm font-medium outline-none"
        >
          {entry.label}
        </button>
        {toggle}
      </div>
      {NOTEWORTHY.has(state.status) && <StatusBadge status={state.status} />}
      {summary && (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {summary}
        </p>
      )}
      {usedBy && (
        <p
          data-slot="extension-users"
          className="mt-auto truncate pt-1 text-xs text-muted-foreground"
        >
          {usedBy}
        </p>
      )}
    </li>
  );
}
