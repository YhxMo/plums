import { cn } from "cn";
import type { Agent } from "../../modules/agents/contract";
import {
  Avatar as AvatarRoot,
  AvatarBadge,
  AvatarFallback,
  AvatarImage,
} from "../components/ui/avatar";

const sizes = {
  normal: "size-10 text-base",
  large: "size-16 text-2xl",
} as const;

/** A hue from the name, so each Agent keeps its own soft colour. */
export function hueOf(name: string) {
  let hash = 0;
  for (const char of name.trim()) hash = (hash * 31 + char.codePointAt(0)!) | 0;
  return Math.abs(hash) % 360;
}

/**
 * An Agent's mark: its picture, or the first character of its name on a soft
 * colour taken from the name. With `status`, a dot shows whether it is
 * working (pulsing) or online.
 */
export function Avatar({
  agent,
  size = "normal",
  status,
  className,
}: {
  agent: Pick<Agent, "name" | "avatar">;
  size?: keyof typeof sizes;
  status?: Agent["status"];
  className?: string;
}) {
  return (
    <AvatarRoot
      aria-hidden="true"
      className={cn(
        sizes[size],
        "rounded-[26%] after:rounded-[26%]",
        className,
      )}
    >
      {agent.avatar && (
        <AvatarImage src={agent.avatar} alt="" className="rounded-[26%]" />
      )}
      <AvatarFallback
        style={{ "--h": hueOf(agent.name) } as React.CSSProperties}
        className="rounded-[26%] bg-[oklch(0.92_0.045_var(--h))] font-medium text-[oklch(0.4_0.09_var(--h))] [font-size:inherit] dark:bg-[oklch(0.36_0.05_var(--h))] dark:text-[oklch(0.9_0.06_var(--h))]"
      >
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
