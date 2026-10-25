import { cn } from "cn";
import { Switch } from "@/components/ui/switch";
import type { Part } from "./parts";

/**
 * The extensions an Agent is composed of, one switch each, in one group
 * separated by hairlines. A part switched off says what that means.
 */
export function AgentParts({
  agentName,
  parts,
  onPart,
  onOpen,
  disabled,
}: {
  agentName: string;
  parts: readonly Part[];
  /** Absent for providers that cannot switch parts off. */
  onPart?: (part: Part, on: boolean) => void;
  /** Opens the extension in management, unless the part has its own page. */
  onOpen?: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <ul
      className="divide-y overflow-hidden rounded-lg border bg-card"
      aria-label={`${agentName} 的组成扩展`}
    >
      {parts.map((part) => {
        const { choice, on, note } = part;
        const warn = !on && note;
        const name = (
          <>
            <span className="truncate text-sm font-medium">{choice.label}</span>
            <span
              className={cn(
                "w-full truncate text-xs text-muted-foreground",
                warn && "text-destructive",
              )}
            >
              {warn ? note : choice.description}
            </span>
          </>
        );
        return (
          <li
            key={choice.id}
            className="flex min-h-13 items-center gap-3 px-3 py-2 has-[[data-slot=part-open]:hover]:bg-subtle/60"
          >
            {onOpen || part.open ? (
              <button
                type="button"
                data-slot="part-open"
                className="flex min-w-0 flex-1 flex-col items-start rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                aria-label={
                  part.open
                    ? `打开 ${choice.label}`
                    : `查看扩展 ${choice.label}`
                }
                onClick={() => (part.open ? part.open() : onOpen!(choice.id))}
              >
                {name}
              </button>
            ) : (
              <span className="flex min-w-0 flex-1 flex-col">{name}</span>
            )}
            {onPart && (
              <Switch
                checked={on}
                disabled={disabled}
                aria-label={`在 ${agentName} 中使用 ${choice.label}`}
                onCheckedChange={(next) => onPart(part, next)}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
