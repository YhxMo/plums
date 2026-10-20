import { useEffect, useRef, useState } from "react";
import type { Agent } from "../../modules/agents/contract";
import { Icon } from "../components/Icon";
import { formatTime } from "./time";
import s from "./AgentList.module.css";
import chatStyles from "./ChatView.module.css";
import detailStyles from "./DetailPanel.module.css";
import { Tooltip } from "../components/Tooltip";
export function Avatar({
  agent,
  size = "normal",
}: {
  agent: Agent;
  size?: "normal" | "large";
}) {
  return (
    <span
      className={`${s.avatar} ${chatStyles.avatar} ${detailStyles.avatar} ${size === "large" ? s.avatarLarge : ""}`}
    >
      <Icon
        name={agent.multiSession ? "code" : "document"}
        size={size === "large" ? 30 : 22}
      />
    </span>
  );
}
export function AgentList({
  agents,
  selected,
  onSelect,
  onAdd,
  onAction,
}: {
  agents: Agent[];
  selected: string | null;
  onSelect: (id: string) => void;
  onAdd: (source: HTMLElement) => void;
  onAction: (
    agent: Agent,
    action: "pin" | "rename" | "remove",
    source: HTMLElement | null,
  ) => void;
}) {
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!menu) return;
    const popup = root.current?.querySelector<HTMLElement>("[role=menu]");
    popup?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const close = (event: PointerEvent) => {
      if (!popup?.parentElement?.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  const shown = agents.filter((a) =>
    a.name.toLowerCase().includes(query.toLowerCase()),
  );
  const pinned = shown.filter((a) => a.pinned);
  return (
    <aside ref={root} className={s.agentList} aria-label="Agent 列表">
      <div className={s.listHeading}>
        <h2>我的 Agent</h2>
        <span>{agents.length}</span>
        <Tooltip label="添加 Agent">
          <button
            className="icon-button"
            aria-label="添加"
            onClick={(e) => onAdd(e.currentTarget)}
          >
            <Icon name="plus" />
          </button>
        </Tooltip>
      </div>
      {agents.length > 0 && (
        <label className={s.search}>
          <Icon name="search" size={17} />
          <input
            aria-label="搜索 Agent"
            placeholder="搜索 Agent"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}
      <div className={s.listScroll}>
        {pinned.length > 0 && (
          <section className={s.pinned}>
            <h3>特别关注</h3>
            <div className={s.pinnedGrid}>
              {pinned.map((a) => (
                <button
                  key={a.id}
                  data-agent-id={a.id}
                  className={s.pinnedAgent}
                  aria-label={`打开 ${a.name}`}
                  aria-pressed={selected === a.id}
                  onClick={() => onSelect(a.id)}
                >
                  <span className={s.pinAvatar}>
                    <Avatar agent={a} size="large" />
                    <span className={s.star}>
                      <Icon name="star" size={12} />
                    </span>
                  </span>
                  <span>{a.name}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {agents.length > 0 && <h3 className={s.sectionLabel}>全部 Agent</h3>}
        {shown.map((a) => {
          const session = a.sessions.find((x) => x.id === a.currentSessionId);
          const lastAt = session?.messages.length
            ? (session.messages.at(-1)?.at ?? session.lastMessageAt)
            : undefined;
          return (
            <div
              className={s.agentRow}
              data-selected={selected === a.id}
              key={a.id}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu(a.id);
              }}
              onPointerDown={(e) => {
                if (e.pointerType === "touch")
                  timer.current = setTimeout(() => setMenu(a.id), 550);
              }}
              onPointerUp={() => clearTimeout(timer.current)}
              onPointerCancel={() => clearTimeout(timer.current)}
              onPointerMove={() => clearTimeout(timer.current)}
            >
              <button
                className={s.agentMain}
                data-agent-id={a.id}
                onClick={() => onSelect(a.id)}
                aria-label={`与 ${a.name} 交互`}
              >
                <Avatar agent={a} />
                <span className={s.agentCopy}>
                  <span className={s.rowTop}>
                    <strong>{a.name}</strong>
                    <span className={s.rowTime}>
                      {lastAt !== undefined &&
                        formatTime(lastAt, undefined, true)}
                    </span>
                  </span>
                  <span>{session?.messages.at(-1)?.text || a.description}</span>
                </span>
                {a.status === "busy" && (
                  <span className={s.statusDot} aria-label="运行中" />
                )}
              </button>
              <button
                className={`icon-button ${s.rowMore}`}
                aria-label={`${a.name} 的操作`}
                onClick={() => setMenu(menu === a.id ? null : a.id)}
                aria-expanded={menu === a.id}
              >
                <Icon name="more" size={17} />
              </button>
              {menu === a.id && (
                <div
                  className={s.agentMenu}
                  role="menu"
                  aria-label={`${a.name} 的操作菜单`}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setMenu(null);
                      e.currentTarget.parentElement
                        ?.querySelector<HTMLButtonElement>("[aria-expanded]")
                        ?.focus();
                    }
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      const items = Array.from(
                        e.currentTarget.querySelectorAll<HTMLButtonElement>(
                          "[role=menuitem]",
                        ),
                      );
                      const index = items.indexOf(
                        document.activeElement as HTMLButtonElement,
                      );
                      items[
                        (index +
                          (e.key === "ArrowDown" ? 1 : -1) +
                          items.length) %
                          items.length
                      ]?.focus();
                    }
                  }}
                >
                  <button
                    role="menuitem"
                    onClick={(e) => {
                      const source =
                        e.currentTarget
                          .closest("[role=menu]")
                          ?.parentElement?.querySelector<HTMLButtonElement>(
                            "[aria-expanded]",
                          ) ?? null;
                      source?.focus();
                      onAction(a, "pin", source);
                      setMenu(null);
                    }}
                  >
                    <Icon name="star" size={16} />
                    {a.pinned ? "取消特别关注" : "设为特别关注"}
                  </button>
                  <button
                    role="menuitem"
                    onClick={(e) => {
                      const source =
                        e.currentTarget
                          .closest("[role=menu]")
                          ?.parentElement?.querySelector<HTMLButtonElement>(
                            "[aria-expanded]",
                          ) ?? null;
                      source?.focus();
                      onAction(a, "rename", source);
                      setMenu(null);
                    }}
                  >
                    重命名
                  </button>
                  <button
                    role="menuitem"
                    onClick={(e) => {
                      const source =
                        e.currentTarget
                          .closest("[role=menu]")
                          ?.parentElement?.querySelector<HTMLButtonElement>(
                            "[aria-expanded]",
                          ) ?? null;
                      source?.focus();
                      onAction(a, "remove", source);
                      setMenu(null);
                    }}
                  >
                    移除 Agent
                  </button>
                  <button role="menuitem" onClick={() => setMenu(null)}>
                    关闭菜单
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {agents.length === 0 && (
          <p className={s.listHint}>添加后，Agent 会出现在这里。</p>
        )}
        {agents.length > 0 && !shown.length && (
          <p className={s.listHint}>
            没有找到 Agent。
            <button className="text-button" onClick={() => setQuery("")}>
              清除搜索
            </button>
          </p>
        )}
      </div>
    </aside>
  );
}
