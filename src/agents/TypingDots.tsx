import { cn } from "cn";

/** Three dots that rise in turn, as IM apps show someone typing. */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex gap-[3px]", className)}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1 animate-typing rounded-full bg-current"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </span>
  );
}
