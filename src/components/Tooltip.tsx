import { type ReactNode } from "react";
import { InfoIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Tooltip as TooltipRoot,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

/**
 * A short label for its single focusable child: after a pause under the
 * pointer, at once on keyboard focus; Escape, a press or leaving hides it,
 * and touch does not show it. Each tooltip brings its provider because
 * extension views mount their own React roots.
 */
export function Tooltip({
  label,
  children,
  side,
}: {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <TooltipProvider delayDuration={400}>
      <TooltipRoot>
        <TooltipTrigger
          asChild
          // Focus given back by a closing dialog or menu after a click is not
          // keyboard focus; preventing the event skips Radix's opening.
          onFocus={(event) => {
            if (!event.currentTarget.matches(":focus-visible"))
              event.preventDefault();
          }}
        >
          {children}
        </TooltipTrigger>
        <TooltipContent side={side} sideOffset={6} collisionPadding={8}>
          {label}
        </TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
}

/** A click/keyboard disclosure; hover labels use Tooltip instead. */
export function InfoTip({ label, text }: { label: string; text: string }) {
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        className="inline-grid size-5 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none max-md:size-11"
        aria-label={`${label}说明`}
      >
        <InfoIcon className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent aria-label={`${label}说明`}>{text}</PopoverContent>
    </Popover>
  );
}
