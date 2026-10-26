import type { CSSProperties } from "react";
import { cn } from "cn";
import type { Agent } from "@modules/agents/contract";
import {
  Avatar as AvatarRoot,
  AvatarBadge,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { plumFor, plumParts, plumShape } from "./plum";

/** A flat plum on a rounded tile, in the colours the name picks. */
function PlumMark({ name }: { name: string }) {
  const plum = plumFor(name);
  return (
    <svg
      viewBox="0 0 48 48"
      className="size-full"
      style={
        {
          "--tile-light": plum.light,
          "--tile-dark": plum.dark,
        } as CSSProperties
      }
    >
      <rect
        data-plum="tile"
        width="48"
        height="48"
        rx={plumShape.tileRadius}
        className="fill-(--tile-light) dark:fill-(--tile-dark)"
      />
      <circle data-plum="body" {...plumShape.body} fill={plum.body} />
      <path
        data-plum="stem"
        d={plumShape.stem}
        stroke={plumParts.stem}
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <path data-plum="leaf" d={plumShape.leaf} fill={plumParts.leaf} />
      {plumShape.eyes.map((cx) => (
        <ellipse
          key={cx}
          data-plum="eye"
          cx={cx}
          {...plumShape.eye}
          fill={plumParts.eye}
        />
      ))}
    </svg>
  );
}

/**
 * An Agent's mark: its picture, or a flat plum in colours taken from its
 * name. With `dot`, a corner dot shows the Agent typing a reply (the brand
 * colour, breathing) or online (green); rows set `--row-typing` where the
 * brand colour would not show.
 */
export function Avatar({
  agent,
  dot,
  className,
}: {
  agent: Pick<Agent, "name" | "avatar">;
  dot?: "typing" | "online";
  className?: string;
}) {
  return (
    <AvatarRoot
      aria-hidden="true"
      className={cn("size-10 rounded-[27%] after:rounded-[27%]", className)}
    >
      {agent.avatar && (
        <AvatarImage src={agent.avatar} alt="" className="rounded-[27%]" />
      )}
      <AvatarFallback className="rounded-[27%] bg-transparent">
        <PlumMark name={agent.name} />
      </AvatarFallback>
      {dot && (
        <AvatarBadge
          data-state={dot}
          className={cn(
            // Rows set --row-bg so the ring matches their tint.
            "size-3! ring-(--row-bg,var(--background))",
            dot === "typing"
              ? "bg-(--row-typing,var(--accent)) motion-safe:animate-pulse"
              : "bg-running",
          )}
        />
      )}
    </AvatarRoot>
  );
}
