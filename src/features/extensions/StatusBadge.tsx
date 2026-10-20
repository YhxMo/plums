import { translateStatus } from "../../shell/messages";
import { Badge } from "../../components/ui/badge";

/** An extension's lifecycle status; running ones carry a live dot. */
export function StatusBadge({ status }: { status: string }) {
  const active = status === "active";
  const failed = status === "failed" || status === "cleanup-failed";
  return (
    <Badge
      variant={failed ? "destructive" : "secondary"}
      className={active ? "bg-running/12 text-foreground" : undefined}
    >
      {active && (
        <span aria-hidden="true" className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-running opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-1.5 rounded-full bg-running" />
        </span>
      )}
      {translateStatus(status)}
    </Badge>
  );
}
