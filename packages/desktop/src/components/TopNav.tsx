import { useEffect, useRef, useState } from "react";
import type { AgentRuntimeState } from "../shared/types.js";
import type { AgentRecord } from "@plums/host";
import { tabs, type Tab, type NavTab } from "../app/route.js";
import { AgentSwitcher } from "./AgentSwitcher.js";
import { Icon, type IconName } from "./Icon.js";
const icons: Record<NavTab, IconName> = {
  home: "agent",
  character: "character",
  extension: "extension",
  settings: "settings",
};
export function TopNav({
  tab,
  agents,
  selected,
  busy,
  primaryImport,
  runtime,
  runtimeBusy,
  onResume,
  inert,
  onTab,
  onAgent,
  onImport,
}: {
  tab: Tab;
  agents: AgentRecord[];
  selected: string;
  busy: boolean;
  primaryImport: boolean;
  runtime: AgentRuntimeState;
  runtimeBusy: boolean;
  onResume: () => void;
  inert: boolean;
  onTab: (tab: NavTab) => void;
  onAgent: (id: string) => void;
  onImport: () => void;
}) {
  const header = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const sentinel = document.getElementById("manager-scroll-sentinel");
    const shell = header.current;
    if (!sentinel || !shell) return;
    let observer: IntersectionObserver;
    const observe = () => {
      observer?.disconnect();
      observer = new IntersectionObserver(
        ([entry]) => setScrolled(!entry.isIntersecting),
        { rootMargin: `-${shell.offsetHeight}px 0px 0px 0px` },
      );
      observer.observe(sentinel);
    };
    const resize = new ResizeObserver(observe);
    resize.observe(shell);
    observe();
    return () => {
      observer.disconnect();
      resize.disconnect();
    };
  }, []);
  return (
    <header
      ref={header}
      className={`top-shell${scrolled ? " scrolled" : ""}`}
      inert={inert}
    >
      <div className="top-shell-inner">
        <div className="brand" aria-label="Plums">
          <span className="brand-mark">
            <Icon name="plum" size={18} />
          </span>
        </div>
        <nav className="top-nav" aria-label="工作台导航">
          {tabs.map(([key, label]) => {
            const active = tab === key || (key === "home" && tab === "status");
            return (
              <button
                type="button"
                key={key}
                data-testid={`nav-tab-${key}`}
                className={active ? "active" : ""}
                data-kind={key}
                aria-current={active ? "page" : undefined}
                onFocus={(event) =>
                  event.currentTarget.scrollIntoView({
                    block: "nearest",
                    inline: "nearest",
                  })
                }
                onClick={() => onTab(key)}
              >
                <Icon name={icons[key]} size={16} />
                {label}
              </button>
            );
          })}
        </nav>
        <div className="header-actions">
          {runtime && (
            <button
              className="ghost sm resume-agent"
              data-testid="resume-agent"
              aria-label="回到运行中的 Agent"
              disabled={runtimeBusy}
              onClick={onResume}
            >
              <i className="running-dot" />
              <span className="resume-wide">运行中 · 回到</span>
              <span className="resume-compact">继续</span>
            </button>
          )}
          <AgentSwitcher
            agents={agents}
            selected={selected}
            onChange={onAgent}
          />
          <button
            type="button"
            className={primaryImport ? "primary sm" : "ghost sm"}
            data-testid="import-file"
            disabled={busy}
            onClick={onImport}
          >
            <Icon name="plus" size={16} />
            导入
          </button>
        </div>
      </div>
    </header>
  );
}
