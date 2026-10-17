import type { ReactNode } from "react";
import styles from "./ExtensionManager.module.css";
export function DiagnosticsPanel({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle(open: boolean): void;
  children: ReactNode;
}) {
  return (
    <details
      className={styles.diagnostics}
      open={open}
      onToggle={(e) => onToggle(e.currentTarget.open)}
    >
      <summary>诊断与实验</summary>
      {children}
    </details>
  );
}
