import { cn } from "cn";
import type { Agent } from "../../modules/agents/contract";
import {
  Avatar as AvatarRoot,
  AvatarBadge,
  AvatarFallback,
} from "../components/ui/avatar";

const sizes = {
  normal: "size-10 text-base",
  large: "size-16 text-2xl",
} as const;

/**
 * An Agent's mark: the first character of its name. With `status`, a dot
 * shows whether it is working (pulsing) or online.
 */
export function Avatar({
  agent,
  size = "normal",
  status,
  className,
}: {
  agent: Pick<Agent, "name">;
  size?: keyof typeof sizes;
  status?: Agent["status"];
  className?: string;
}) {
  return (
    <AvatarRoot aria-hidden="true" className={cn(sizes[size], className)}>
      <AvatarFallback className="bg-subtle font-medium text-foreground/80 [font-size:inherit]">
        {[...agent.name.trim()][0] ?? "?"}
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
