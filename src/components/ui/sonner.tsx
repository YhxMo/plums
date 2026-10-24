import { useSyncExternalStore } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";

// Follows the shell's data-theme instead of a theme provider; the document is
// read only on render so the module loads outside a browser.
const subscribe = (listener: () => void) => {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
};
const appearance = () =>
  document.documentElement.dataset.theme === "dark" ? "dark" : "light";
// Below the title bar and under menus, which open above a passing notice.
const offset = { top: "calc(env(safe-area-inset-top, 0px) + 60px)" };

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useSyncExternalStore(subscribe, appearance);

  return (
    <Sonner
      theme={theme}
      className="toaster group z-40!"
      offset={offset}
      mobileOffset={offset}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--color-popover)",
          "--normal-text": "var(--color-popover-foreground)",
          "--normal-border": "var(--color-border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          // A text button in the brand colour, like the app's other actions.
          actionButton:
            "bg-transparent! font-semibold! text-brand-text! hover:bg-muted!",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
