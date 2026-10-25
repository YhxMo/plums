import { cn } from "cn";
import { translateStatus } from "@/shell/messages";

/** An extension's lifecycle status: a coloured dot and its word. */
export function StatusBadge({ status }: { status: string }) {
  const failed = status === "failed" || status === "cleanup-failed";
  return (
    <span
      data-slot="status"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground",
        failed && "text-destructive",
      )}
    >
      <span
        data-slot="status-dot"
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full bg-input",
          status === "active" && "bg-running",
          failed && "bg-destructive",
        )}
      />
      {translateStatus(status)}
    </span>
  );
}
