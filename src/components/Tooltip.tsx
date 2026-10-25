import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
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

/**
 * An explanation behind an info button. A mouse shows it while over the
 * button, without moving focus; a click, a tap or the keyboard opens it and
 * keeps it open, focused, until a second press, Escape or a press outside.
 */
export function InfoTip({ label, text }: { label: string; text: string }) {
  const [shown, setShown] = useState<"closed" | "hover" | "kept">("closed");
  // How it was last opened; focus moves in and back only when kept.
  const kept = useRef(false);
  const show = (how: "hover" | "kept") => {
    kept.current = how === "kept";
    setShown(how);
  };
  const opening = useRef<number>(undefined);
  const content = useRef<HTMLDivElement>(null);
  const wait = () => window.clearTimeout(opening.current);
  useEffect(() => wait, []);
  const mouse = (event: PointerEvent) => event.pointerType === "mouse";
  return (
    <Popover
      open={shown !== "closed"}
      onOpenChange={(open) => !open && setShown("closed")}
    >
      <PopoverTrigger
        type="button"
        className="inline-grid size-5 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none max-md:size-11"
        aria-label={`${label}说明`}
        onPointerEnter={(event) => {
          if (!mouse(event) || shown !== "closed") return;
          opening.current = window.setTimeout(() => show("hover"), 150);
        }}
        onPointerLeave={(event) => {
          if (!mouse(event)) return;
          wait();
          setShown((now) => (now === "hover" ? "closed" : now));
        }}
        // The press is handled here; preventing it skips Radix's toggle.
        onClick={(event) => {
          event.preventDefault();
          wait();
          if (shown === "kept") return setShown("closed");
          show("kept");
          // Already open under the pointer: Radix focuses only on opening.
          if (shown === "hover") content.current?.focus();
        }}
      >
        <InfoIcon className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent
        ref={content}
        aria-label={`${label}说明`}
        onOpenAutoFocus={(event) => {
          if (!kept.current) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (!kept.current) event.preventDefault();
        }}
      >
        {text}
      </PopoverContent>
    </Popover>
  );
}
