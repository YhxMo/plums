import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { ChevronLeftIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "./ui/button";
import { Dialog as DialogRoot, DialogContent, DialogTitle } from "./ui/dialog";
import { SheetContent } from "./ui/sheet";
import { LayerContainer } from "./ui/layer";
import { Toaster } from "./ui/sonner";
import { useToastLayers } from "./toast-layers";

/** The focused element, or the button of the menu it sits in (an item
 * goes away with its menu). */
function menuOpener() {
  const active = document.activeElement as HTMLElement | null;
  const menu = active?.closest<HTMLElement>('[role="menu"]');
  return (
    (menu?.id &&
      document.querySelector<HTMLElement>(
        `[aria-controls="${CSS.escape(menu.id)}"]`,
      )) ||
    active
  );
}

/**
 * A modal dialog that is open while mounted. Focus starts at the title,
 * and on close returns to the opener while it is still shown, else to
 * `fallbackFocus`. `onBack` adds a back button for a dialog reached from
 * another step. `sheet` slides in from the bottom (phones) or the right
 * without a title bar, for content that brings its own; the right one is a
 * non-modal drawer that leaves the page usable and stays open until closed.
 */
export function Dialog({
  title,
  children,
  onClose,
  onBack,
  returnFocusTo,
  fallbackFocus,
  sheet,
  className,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onBack?: () => void;
  returnFocusTo?: HTMLElement | null;
  fallbackFocus?: () => HTMLElement | null;
  sheet?: "bottom" | "right";
  className?: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // WebKit does not focus a clicked button, so the opener is recorded too.
  const opener = useRef(returnFocusTo ?? menuOpener());
  const fallback = useRef(fallbackFocus);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const toaster = useId();
  const drawer = sheet === "right";
  useEffect(() => {
    const { push, remove } = useToastLayers.getState();
    push(toaster);
    return () => remove(toaster);
  }, [toaster]);
  const props = {
    ref: setContent,
    "aria-modal": !drawer,
    "aria-describedby": undefined,
    showCloseButton: false,
    onCloseAutoFocus(event: Event) {
      event.preventDefault();
      const active = opener.current;
      if (active?.isConnected && active.getClientRects().length) active.focus();
      else fallback.current?.()?.focus();
    },
  };
  const body = (
    <LayerContainer value={content}>
      {children}
      <Toaster id={toaster} position="top-center" />
    </LayerContainer>
  );
  return (
    <DialogRoot
      open
      modal={!drawer}
      onOpenChange={(open) => !open && onClose()}
    >
      {sheet ? (
        <SheetContent
          {...props}
          side={sheet}
          onInteractOutside={(event) => drawer && event.preventDefault()}
          className={cn(
            "gap-0 border-0 shadow-float",
            sheet === "bottom"
              ? "max-h-[88dvh] overflow-auto rounded-t-2xl"
              : "overflow-hidden rounded-xl data-[side=right]:top-12 data-[side=right]:right-2 data-[side=right]:bottom-2 data-[side=right]:h-auto data-[side=right]:w-80 data-[side=right]:max-w-[calc(100vw-1rem)] data-[side=right]:sm:max-w-80",
            className,
          )}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          {sheet === "bottom" && (
            <span
              aria-hidden="true"
              className="mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-border"
            />
          )}
          {body}
        </SheetContent>
      ) : (
        <DialogContent
          {...props}
          className={cn(
            "max-h-[calc(100dvh-2rem)] max-w-[520px] gap-0 overflow-auto p-0",
            className,
          )}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            heading.current?.focus({ preventScroll: true });
          }}
        >
          <header
            className={cn(
              "sticky top-0 z-10 flex items-center gap-1 border-b bg-popover/85 py-2.5 pr-3 backdrop-blur-md",
              onBack ? "pl-2" : "pl-5",
            )}
          >
            {onBack && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="返回"
                data-dialog-back
                onClick={onBack}
              >
                <ChevronLeftIcon />
              </Button>
            )}
            <DialogTitle
              ref={heading}
              tabIndex={-1}
              className="mr-auto text-[15px] font-semibold outline-none"
            >
              {title}
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              aria-label="关闭"
              onClick={onClose}
            >
              <XIcon />
            </Button>
          </header>
          {body}
        </DialogContent>
      )}
    </DialogRoot>
  );
}

/** The padded content of a `Dialog`. */
export function DialogBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("grid gap-4 px-5 py-4 text-sm leading-relaxed", className)}
      {...props}
    />
  );
}

/** Actions under a `Dialog`'s content, primary last; full width on phones. */
export function DialogActions({
  className,
  ...props
}: ComponentProps<"footer">) {
  return (
    <footer
      className={cn(
        "sticky bottom-0 flex justify-end gap-2 border-t bg-muted/60 px-5 py-3 backdrop-blur-md max-md:*:flex-1",
        className,
      )}
      {...props}
    />
  );
}
