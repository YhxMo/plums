import { FileTextIcon, SquareTerminalIcon } from "lucide-react";
import { cn } from "cn";
import type { Agent } from "../../modules/agents/contract";

/** An Agent's mark: a terminal for multi-session Agents, a page otherwise. */
export function Avatar({
  agent,
  size = "normal",
  className,
}: {
  agent: Pick<Agent, "multiSession">;
  size?: "small" | "normal" | "large";
  className?: string;
}) {
  const Icon = agent.multiSession ? SquareTerminalIcon : FileTextIcon;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center bg-linear-to-br from-brand-soft to-brand-soft/40 text-brand-text ring-1 ring-brand/10",
        size === "small" && "size-7 rounded-lg [&_svg]:size-4",
        size === "normal" && "size-9 rounded-[11px] [&_svg]:size-5",
        size === "large" && "size-14 rounded-2xl [&_svg]:size-7",
        className,
      )}
    >
      <Icon strokeWidth={1.6} />
    </span>
  );
}
