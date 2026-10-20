import { useState } from "react";
import { diagnoseLayoutFallback } from "../../modules/shell/diagnostics";
import type { ShellFeedbackProps } from "./controllers";
import { Icon } from "../components/Icon";
import { ActionToast } from "../components/Toast";
import layoutStyles from "./layout.module.css";
export function ShellFeedback({
  runtime,
  operations,
  workspace,
  appearance,
  navigation,
  failedImports,
}: ShellFeedbackProps) {
  const [dismissedFallback, setDismissedFallback] = useState("");
  const fallbackDiagnosis = diagnoseLayoutFallback(
    runtime.host,
    runtime.catalog,
    workspace.selected,
    workspace.activeView,
    workspace.failedViews,
    failedImports,
  );
  const { error, notice, setError, setNotice } = operations;
  const { themeId, currentTheme } = appearance;
  return (
    <>
      {fallbackDiagnosis &&
        dismissedFallback !== fallbackDiagnosis.signature && (
          <div
            role="status"
            className={`theme-fallback ${layoutStyles.fallbackBanner}`}
          >
            <span>{fallbackDiagnosis.message}</span>
            <div className={layoutStyles.fallbackActions}>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  navigation.openManager(
                    false,
                    fallbackDiagnosis.targetExtensionId,
                  );
                }}
              >
                查看原因
              </button>
              <button
                type="button"
                className="topbar-ghost"
                aria-label="关闭所选界面提示"
                onClick={() =>
                  setDismissedFallback(fallbackDiagnosis.signature)
                }
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          </div>
        )}
      {themeId && !currentTheme && (
        <p role="status" className="theme-fallback">
          所选主题 {themeId} 暂不可用，已使用内置外观；再次启用该主题后恢复。
        </p>
      )}
      <ActionToast
        error={error}
        notice={notice}
        onDone={() => {
          setError("");
          setNotice("");
        }}
      />
    </>
  );
}
