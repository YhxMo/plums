import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ConfirmationView, TaskChoice } from "./confirm-window.js";
import { Icon } from "./components/Icon.js";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
declare global {
  interface Window {
    confirmation: {
      load: () => Promise<ConfirmationView & { token: string }>;
      answer: (
        token: string,
        allow: boolean,
        choice?: TaskChoice,
      ) => Promise<boolean>;
    };
  }
}
function Confirmation() {
  const [view, setView] = useState<ConfirmationView & { token: string }>();
  const [selected, setSelected] = useState<string[]>([]);
  const [durationMs, setDuration] = useState(900_000);
  const [ready, setReady] = useState(false);
  const deny = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    void window.confirmation.load().then((value) => {
      if (!alive) return;
      setView(value);
      if (value.kind === "grant") setDuration(3_600_000);
      setSelected(value.scopeOptions?.map((option) => option.key) ?? []);
      timer = setTimeout(() => setReady(true), 700);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (view) deny.current?.focus();
  }, [view]);
  useEffect(() => {
    if (!view) return;
    const restoreFocus = (event: FocusEvent) => {
      if (!dialog.current?.contains(event.target as Node))
        deny.current?.focus();
    };
    const outsideKey = (event: KeyboardEvent) => {
      if (dialog.current?.contains(event.target as Node)) return;
      if (event.key === "Tab") {
        event.preventDefault();
        deny.current?.focus();
      } else if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        void window.confirmation.answer(view.token, false);
      }
    };
    document.addEventListener("focusin", restoreFocus);
    document.addEventListener("keydown", outsideKey);
    return () => {
      document.removeEventListener("focusin", restoreFocus);
      document.removeEventListener("keydown", outsideKey);
    };
  }, [view]);
  if (!view)
    return (
      <p className="confirmation-loading" role="status">
        正在读取安全确认…
      </p>
    );
  const answer = (allow: boolean) => {
    void window.confirmation.answer(
      view.token,
      allow,
      view.scopeOptions ? { selected, durationMs } : undefined,
    );
  };
  return (
    <section
      ref={dialog}
      className="confirmation-page"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirmation-title"
      aria-describedby="confirmation-action"
      data-kind={view.kind}
      data-operation={view.operation}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" ||
          (event.key === "Enter" &&
            !(
              (view.kind === "task" || view.kind === "grant") &&
              event.target instanceof HTMLSelectElement
            ))
        ) {
          event.preventDefault();
          answer(false);
        }
        if (event.key === "Tab") {
          event.preventDefault();
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "button, input, select, textarea, a[href], [tabindex]",
            ),
          ).filter(
            (element) =>
              element.tabIndex >= 0 &&
              !element.matches(":disabled") &&
              !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
              element.getClientRects().length > 0 &&
              getComputedStyle(element).visibility === "visible",
          );
          const index = controls.indexOf(document.activeElement as HTMLElement);
          const next =
            index < 0
              ? event.shiftKey
                ? controls.length - 1
                : 0
              : (index + (event.shiftKey ? -1 : 1) + controls.length) %
                controls.length;
          controls[next]?.focus();
        }
      }}
    >
      <div className="confirmation-drag-region" aria-hidden="true" />
      <header className="confirmation-heading">
        <span className="confirmation-brand">
          <Icon name="plum" size={20} />
          Plums 安全确认
        </span>
        <span className="confirmation-symbol">
          <Icon name="shield" size={28} />
        </span>
        <h1 id="confirmation-title">
          {view.kind === "engine-trust"
            ? "信任并启动本机引擎？"
            : view.kind === "grant"
              ? "批准助理处理范围？"
              : view.kind === "task"
                ? "批准本次工作范围？"
                : view.kind === "capability"
                  ? "允许这次操作？"
                  : "同意组件权限？"}
        </h1>
      </header>
      <div className="confirmation-body">
        <strong className="confirmation-subject">{view.subject}</strong>
        <p id="confirmation-action">{view.action}</p>
        {view.host && (
          <div className="confirmation-destination">
            <Icon name="connector" size={18} />
            <span>
              目标网站 <strong>{view.host}</strong>
            </span>
          </div>
        )}
        {view.reason && (
          <div className="confirmation-reason">
            <span>扩展作者的说明</span>
            <p>{view.reason}</p>
          </div>
        )}
        {view.permissions?.map((entry, index) => (
          <div className="confirmation-permissions" key={index}>
            <strong>{entry.name}</strong>
            <ul>
              {entry.descriptions.map((description, i) => (
                <li key={i}>{description}</li>
              ))}
            </ul>
          </div>
        ))}
        {view.scopeOptions && (
          <fieldset>
            <legend>本次任务范围（可缩小）</legend>
            {view.scopeOptions.map((option) => (
              <label key={option.key} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  checked={selected.includes(option.key)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked
                        ? [...old, option.key]
                        : old.filter((key) => key !== option.key),
                    )
                  }
                />
                {option.label}
              </label>
            ))}
            <label>
              有效期{" "}
              <select
                value={durationMs}
                onChange={(e) => setDuration(Number(e.target.value))}
              >
                <option value={900_000}>15 分钟</option>
                <option value={3_600_000}>1 小时</option>
              </select>
            </label>
            <p>未选中的读写或联网需单独确认。范围外声明仍直接拒绝。</p>
          </fieldset>
        )}
        <p className="confirmation-note">
          {view.kind === "engine-trust"
            ? "信任将保留，直到你撤销授权或删除这个 Agent。"
            : view.kind === "grant"
              ? "授权会保存在当前 Agent，可随时撤销；到期、升级或模型配置变化后重新批准。自动任务只处理所选范围。"
              : view.kind === "task"
                ? "授权仅属于当前 Agent，本次任务最长 1 小时。可随时停止并撤权；升级、配置或目录变更后重新批准。目录授权不等于系统沙箱。"
                : view.kind === "capability"
                  ? "仅允许这一次操作。未被有效工作范围覆盖的后续操作仍会询问。"
                  : "开始使用时可批准有限期工作范围；未覆盖的读写、列目录或联网仍需确认。"}
        </p>
      </div>
      <footer className="confirmation-footer">
        <button ref={deny} onClick={() => answer(false)}>
          {view.kind === "engine-trust" ? "暂不启动" : "不允许"}
        </button>
        <button
          className="primary"
          data-testid="confirm-allow"
          disabled={!ready}
          onClick={() => answer(true)}
        >
          {view.kind === "engine-trust" ? "信任并启动" : "允许"}
        </button>
      </footer>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<Confirmation />);
