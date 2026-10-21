import { FileTextIcon, SquareTerminalIcon } from "lucide-react";
import { cn } from "cn";
import type { Agent } from "../../modules/agents/contract";
import {
  Avatar as AvatarRoot,
  AvatarBadge,
  AvatarFallback,
} from "../components/ui/avatar";

const sizes = {
  small: "size-7 [&_svg]:size-3.5",
  normal: "size-10 [&_svg]:size-5",
  large: "size-16 [&_svg]:size-7",
} as const;

/**
 * An Agent's mark: a terminal for multi-session Agents, a page otherwise.
 * With `status`, a dot shows whether it is working (pulsing) or online.
 */
export function Avatar({
  agent,
  size = "normal",
  status,
  className,
}: {
  agent: Pick<Agent, "multiSession">;
  size?: keyof typeof sizes;
  status?: Agent["status"];
  className?: string;
}) {
  const Icon = agent.multiSession ? SquareTerminalIcon : FileTextIcon;
  return (
    <AvatarRoot aria-hidden="true" className={cn(sizes[size], className)}>
      <AvatarFallback className="bg-linear-to-br from-brand-soft to-brand-soft/50 text-brand-text">
        <Icon strokeWidth={1.6} />
      </AvatarFallback>
      {status && status !== "idle" && (
        <AvatarBadge
          className={cn(
            // Rows set --row-bg so the ring matches their tint.
            "size-3! bg-running ring-(--row-bg,var(--background))",
            status === "busy" && "animate-pulse",
          )}
        />
      )}
    </AvatarRoot>
  );
}
