import type { ReactNode } from "react";
import { PencilIcon, StarIcon, StarOffIcon, Trash2Icon } from "lucide-react";
import type { Agent } from "@modules/agents/contract";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";

export type AgentAction = "pin" | "rename" | "remove";

/** The same Agent actions for its dropdown and its right-click menu. */
export function AgentMenuItems({
  agent,
  kind,
  onAction,
}: {
  agent: Agent;
  kind: "dropdown" | "context";
  onAction: (action: AgentAction) => void;
}) {
  const Item = kind === "dropdown" ? DropdownMenuItem : ContextMenuItem;
  const Separator =
    kind === "dropdown" ? DropdownMenuSeparator : ContextMenuSeparator;
  const item = (action: AgentAction, icon: ReactNode, label: string) => (
    <Item
      variant={action === "remove" ? "destructive" : "default"}
      onSelect={() => onAction(action)}
    >
      {icon}
      {label}
    </Item>
  );
  return (
    <>
      {item(
        "pin",
        agent.pinned ? <StarOffIcon /> : <StarIcon />,
        agent.pinned ? "取消特别关注" : "设为特别关注",
      )}
      {item("rename", <PencilIcon />, "重命名")}
      <Separator />
      {item("remove", <Trash2Icon />, "移除 Agent")}
    </>
  );
}
