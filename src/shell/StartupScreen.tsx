import { useEffect, useRef, useState } from "react";
import { recoverComposition } from "@modules/shell/composition-recovery";
import { motion } from "motion/react";
import { Dialog, DialogActions, DialogBody } from "@/components/Dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CompositionRecovery } from "./runtime";
import { errorMessage } from "./messages";

export function StartupScreen({ reason }: { reason?: unknown }) {
  const [recovery, setRecovery] = useState<CompositionRecovery | null>(
    reason instanceof CompositionRecovery ? reason : null,
  );
  const [confirmRecovery, setConfirmRecovery] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryLocked, setRecoveryLocked] = useState(false);
  const recoveryTrigger = useRef<HTMLElement | null>(null);
  const reloadButton = useRef<HTMLButtonElement>(null);
  const recoveryFinished = useRef(false);
  useEffect(() => {
    if (!confirmRecovery && recoveryFinished.current) {
      recoveryFinished.current = false;
      reloadButton.current?.focus();
    }
  }, [confirmRecovery]);
  const [error, setError] = useState(reason ? errorMessage(reason) : "");
  return (
    <main className="grid min-h-dvh place-items-center bg-sidebar p-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex max-w-md flex-col items-center gap-3 text-center"
      >
        <img
          className="size-14 rounded-xl object-contain"
          src="/brand/plums.png"
          alt=""
        />
        <h1 className="text-2xl font-semibold tracking-tight">Plums</h1>
        <p
          role={error ? "alert" : "status"}
          className="flex items-center gap-2 text-muted-foreground"
        >
          {!error && <Spinner />}
          {error || "正在读取本地扩展…"}
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {error && (
            <Button
              ref={reloadButton}
              disabled={recovering}
              onClick={() => location.reload()}
            >
              重新加载
            </Button>
          )}
          {recovery && !recoveryLocked && (
            <Button
              variant="outline"
              onClick={(event) => {
                recoveryTrigger.current = event.currentTarget;
                setConfirmRecovery(true);
              }}
            >
              恢复默认组合
            </Button>
          )}
        </div>
      </motion.div>
      {confirmRecovery && recovery && (
        <Dialog
          title="恢复默认组合"
          returnFocusTo={recoveryTrigger.current}
          onClose={() => {
            if (!recovering) setConfirmRecovery(false);
          }}
        >
          <DialogBody>
            <p>
              先独立备份原应用配置，再重置损坏的组合。角色、会话、外观、安装路径及扩展数据保留；重新加载后启动默认组合。
            </p>
            <p>
              备份保留在本地应用状态目录，不自动清理。此操作不能修复其他配置损坏。
            </p>
          </DialogBody>
          <DialogActions>
            <Button
              variant="outline"
              disabled={recovering}
              onClick={() => setConfirmRecovery(false)}
            >
              取消
            </Button>
            <Button
              disabled={recovering}
              onClick={() => {
                setRecovering(true);
                const backupOwner = `host.recovery.${crypto.randomUUID()}`;
                void recoverComposition(
                  recovery.adapter,
                  recovery.saved,
                  backupOwner,
                )
                  .then(() => {
                    setRecovery(null);
                    setError(
                      `原配置已备份至 ${backupOwner}，组合已重置，请重新加载。`,
                    );
                  })
                  .catch((reason) => {
                    setRecoveryLocked(true);
                    setError(
                      `恢复未确认完成：${errorMessage(reason)}。请重新加载确认实际结果；本次备份标识：${backupOwner}，是否已写入须核对。`,
                    );
                  })
                  .finally(() => {
                    recoveryFinished.current = true;
                    setRecovering(false);
                    setConfirmRecovery(false);
                  });
              }}
            >
              备份并重置组合
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </main>
  );
}
