import { motion } from "motion/react";
import { cn } from "cn";

/** Three dots that rise in turn, as IM apps show someone typing. */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex gap-[3px]", className)}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1 rounded-full bg-current"
          animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </span>
  );
}
