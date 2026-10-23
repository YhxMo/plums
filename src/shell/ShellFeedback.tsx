import { useState, type ReactNode } from "react";
import { diagnoseLayoutFallback } from "@modules/shell/diagnostics";
import type { ShellFeedbackProps } from "./controllers";
import { TriangleAlertIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { ActionToast } from "@/components/Toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** A dismissable notice above the workspace. */
function Banner({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18 }}
      className="shrink-0 overflow-hidden px-2 pb-2 md:pr-14"
    >
      {children}
    </motion.div>
  );
}
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
      <AnimatePresence initial={false}>
        {fallbackDiagnosis &&
          dismissedFallback !== fallbackDiagnosis.signature && (
            <Banner key="fallback">
              <Alert
                role="status"
                className="flex items-center gap-3 border-0 bg-brand-soft py-1.5 pr-1.5 shadow-panel"
              >
                <TriangleAlertIcon className="size-4 shrink-0 text-brand-text" />
                <AlertDescription className="flex-1 text-foreground">
                  {fallbackDiagnosis.message}
                </AlertDescription>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    navigation.openManager(
                      false,
                      fallbackDiagnosis.targetExtensionId,
                    );
                  }}
                >
                  查看原因
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="关闭所选界面提示"
                  onClick={() =>
                    setDismissedFallback(fallbackDiagnosis.signature)
                  }
                >
                  <XIcon />
                </Button>
              </Alert>
            </Banner>
          )}
        {themeId && !currentTheme && (
          <Banner key="theme">
            <Alert
              role="status"
              className="flex items-center gap-3 border-0 bg-brand-soft py-2 shadow-panel"
            >
              <TriangleAlertIcon className="size-4 shrink-0 text-brand-text" />
              <AlertDescription className="text-foreground">
                所选主题 {themeId}{" "}
                暂不可用，已使用内置外观；再次启用该主题后恢复。
              </AlertDescription>
            </Alert>
          </Banner>
        )}
      </AnimatePresence>
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
