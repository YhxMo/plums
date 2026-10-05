import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ConfirmationView } from "./confirm-window.js";
import { Icon } from "./components/Icon.js";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
declare global {
  interface Window {
    confirmation: {
      load: () => Promise<ConfirmationView & { token: string }>;
      answer: (token: string, allow: boolean) => Promise<boolean>;
    };
  }
}
function Confirmation() {
  const [view, setView] = useState<ConfirmationView & { token: string }>();
  const [ready, setReady] = useState(false);
  const deny = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    void window.confirmation.load().then((value) => {
      if (!alive) return;
      setView(value);
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
  if (!view)
    return (
      <p className="confirmation-loading" role="status">
        正在读取安全确认…
      </p>
    );
  const answer = (allow: boolean) => {
    void window.confirmation.answer(view.token, allow);
  };
  return (
    <section
      className="confirmation-page"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirmation-title"
      aria-describedby="confirmation-action"
      data-kind={view.kind}
      data-operation={view.operation}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Enter") {
          event.preventDefault();
          answer(false);
        }
        if (event.key === "Tab") {
          event.preventDefault();
          const target =
            document.activeElement === deny.current && ready
              ? document.querySelector<HTMLButtonElement>(
                  '[data-testid="confirm-allow"]',
                )
              : deny.current;
          target?.focus();
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
          {view.kind === "capability" ? "允许这次操作？" : "同意组件权限？"}
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
        <p className="confirmation-note">
          {view.kind === "capability"
            ? "仅允许这一次操作。后续写入、运行或联网仍会询问。"
            : "写入、运行或联网请求仍会逐次确认。"}
        </p>
      </div>
      <footer className="confirmation-footer">
        <button ref={deny} onClick={() => answer(false)}>
          不允许
        </button>
        <button
          className="primary"
          data-testid="confirm-allow"
          disabled={!ready}
          onClick={() => answer(true)}
        >
          允许
        </button>
      </footer>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<Confirmation />);
