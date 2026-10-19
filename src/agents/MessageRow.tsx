import type { Agent, Message } from "../../modules/agents/contract";
import { Avatar } from "./AgentList";
import { Icon } from "../components/Icon";
import s from "./ChatView.module.css";

export type MessageAction = "copy" | "resend" | "delete";

/** One chat line: avatar, bubble and the desktop hover actions. */
export function MessageRow({
  agent,
  role,
  text,
  status,
  message,
  busy,
  copied,
  menuOpen,
  canDelete,
  onAction,
  onMenu,
}: {
  agent: Agent;
  role: Message["role"];
  text: string;
  /** Live region for the typing line. */
  status?: boolean;
  /** Saved messages get actions; pending and typing lines do not. */
  message?: Message;
  busy?: boolean;
  copied?: boolean;
  menuOpen?: boolean;
  canDelete?: boolean;
  onAction?: (action: MessageAction, message: Message) => void;
  onMenu?: (message: Message, x: number, y: number) => void;
}) {
  const user = role === "user";
  return (
    <div
      className={`${s.message} ${user ? s.userMessage : ""}`}
      data-menu-open={menuOpen || undefined}
    >
      <span className={s.sideAvatar} aria-hidden="true">
        {user ? (
          <span className={s.meAvatar}>你</span>
        ) : (
          <Avatar agent={agent} />
        )}
      </span>
      {!user && (
        <span className={s.senderName} aria-hidden="true">
          {agent.name}
        </span>
      )}
      <span className="sr-only">{user ? "你" : agent.name}：</span>
      <p
        role={status ? "status" : undefined}
        className={status ? s.typing : undefined}
        onContextMenu={
          message && onMenu
            ? (e) => {
                if (!matchMedia("(min-width: 768px)").matches) return;
                e.preventDefault();
                onMenu(message, e.clientX, e.clientY);
              }
            : undefined
        }
      >
        {status && <span aria-hidden="true" />}
        {text}
      </p>
      {message && onAction && (
        <div className={s.messageActions} data-message-id={message.id}>
          <button
            className="icon-button"
            aria-label={copied ? "已复制" : "复制"}
            title={copied ? "已复制" : "复制"}
            onClick={() => onAction("copy", message)}
          >
            <Icon name={copied ? "check" : "copy"} size={15} />
          </button>
          {user && (
            <button
              className="icon-button"
              aria-label="重新发送"
              title="重新发送"
              disabled={busy}
              onClick={() => onAction("resend", message)}
            >
              <Icon name="retry" size={15} />
            </button>
          )}
          {canDelete && (
            <button
              className="icon-button"
              aria-label="删除"
              title="删除"
              disabled={busy}
              onClick={() => onAction("delete", message)}
            >
              <Icon name="trash" size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
