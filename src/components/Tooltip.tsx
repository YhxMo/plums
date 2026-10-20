import { useId, useRef, useState, type ReactNode } from "react";
import { InfoIcon } from "lucide-react";
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
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} sideOffset={6} collisionPadding={8}>
          {label}
        </TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
}

/** An info button whose explanation shows in a tooltip; a press toggles it. */
export function InfoTip({ label, text }: { label: string; text: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  // Whether it was shown when the press began: the tooltip already closes
  // itself on that press, before the click arrives.
  const shownAtPress = useRef<boolean | null>(null);
  return (
    <TooltipProvider delayDuration={400}>
      <TooltipRoot open={open} onOpenChange={setOpen}>
        <TooltipTrigger
          type="button"
          className="inline-grid size-5 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none max-md:size-11"
          aria-label={`${label}说明`}
          aria-describedby={id}
          // Skip the tooltip's own close-on-press and open-on-focus; the
          // click below decides.
          onPointerDown={(event) => {
            shownAtPress.current = open;
            event.preventDefault();
          }}
          onFocus={(event) => {
            if (shownAtPress.current !== null) event.preventDefault();
          }}
          onClick={(event) => {
            event.preventDefault();
            const shown = shownAtPress.current ?? open;
            shownAtPress.current = null;
            setOpen(!shown);
          }}
        >
          <InfoIcon className="size-3.5" />
          <span id={id} hidden>
            {text}
          </span>
        </TooltipTrigger>
        <TooltipContent sideOffset={6} collisionPadding={8}>
          {text}
        </TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
}
