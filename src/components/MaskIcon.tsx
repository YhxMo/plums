import type { CSSProperties } from "react";
import { cn } from "cn";
import { viewIconUrl } from "@modules/sdk/view-icon";

/**
 * A one-colour icon from SVG text, drawn as a CSS mask filled with the
 * current text colour: the SVG is an image, so nothing in it runs, and the
 * caller decides its colour. Pass only text that passed `viewIconProblem`.
 */
export function MaskIcon({
  svg,
  name,
  className,
}: {
  svg: string;
  /** What it shows, for tests and styling (`data-icon`). */
  name: string;
  className?: string;
}) {
  const url = viewIconUrl(svg);
  return (
    <span
      aria-hidden="true"
      data-slot="mask-icon"
      data-icon={name}
      className={cn(
        "inline-block size-6 shrink-0 bg-current [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]",
        className,
      )}
      // The prefixed property serves WebKit before Safari 15.4.
      style={{ maskImage: url, WebkitMaskImage: url } as CSSProperties}
    />
  );
}
