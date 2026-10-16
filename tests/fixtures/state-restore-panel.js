/** @typedef {{revision:number, from:number, to:number, current:unknown, target:unknown}} RestorePreview */
/** @typedef {{preview(signal?:AbortSignal):Promise<RestorePreview|null>, restore(revision:number,signal?:AbortSignal):Promise<import('../../modules/sdk').StoredState>}} RestoreService */

/** @type {import('../../modules/sdk').ExtensionDefinition} */
export default {
  manifest: {
    id: "sample.restore-panel",
    version: "1.0.0",
    apiVersion: 1,
    requires: { "sample.restore": 1 },
  },
  activate(ctx) {
    /** @type {RestoreService} */
    const service = ctx.use("sample.restore");
    ctx.view({
      id: "sample.restore-panel",
      label: "状态恢复样板",
      mount(root) {
        const controller = new AbortController();
        let disposed = false;
        let pending = false;
        /** @type {RestorePreview|null} */
        let preview = null;
        /** @type {RestorePreview|null} */
        let confirmation = null;
        const section = document.createElement("section");
        section.className = "restore-panel";
        const heading = document.createElement("h1");
        heading.textContent = "恢复旧快照";
        const description = document.createElement("p");
        description.textContent =
          "先核对当前状态与恢复目标，再明确确认。此样板仅用于隔离合成数据。";
        const status = document.createElement("p");
        status.dataset.testid = "restore-status";
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        status.textContent = "请先读取预览。读取不会提交恢复。";
        const actions = document.createElement("div");
        actions.className = "restore-actions";
        const refresh = document.createElement("button");
        refresh.type = "button";
        refresh.textContent = "读取预览";
        refresh.dataset.testid = "restore-refresh";
        const open = document.createElement("button");
        open.type = "button";
        open.textContent = "恢复此快照";
        open.dataset.testid = "restore-open";
        open.disabled = true;
        actions.append(refresh, open);
        const comparison = document.createElement("div");
        comparison.className = "restore-comparison";
        const currentCard = document.createElement("section");
        const currentTitle = document.createElement("h2");
        currentTitle.textContent = "当前状态";
        const currentMeta = document.createElement("p");
        currentMeta.textContent = "尚未读取";
        const current = document.createElement("pre");
        current.dataset.testid = "restore-current";
        current.textContent = "—";
        currentCard.append(currentTitle, currentMeta, current);
        const targetCard = document.createElement("section");
        const targetTitle = document.createElement("h2");
        targetTitle.textContent = "恢复目标";
        const targetMeta = document.createElement("p");
        targetMeta.textContent = "尚未读取";
        const target = document.createElement("pre");
        target.dataset.testid = "restore-target";
        target.textContent = "—";
        targetCard.append(targetTitle, targetMeta, target);
        comparison.append(currentCard, targetCard);
        const dialog = document.createElement("dialog");
        dialog.dataset.testid = "restore-dialog";
        dialog.setAttribute("aria-label", "确认恢复旧快照");
        const dialogHeading = document.createElement("h2");
        dialogHeading.textContent = "确认恢复旧快照";
        const summary = document.createElement("p");
        const dialogTarget = document.createElement("pre");
        const caution = document.createElement("p");
        caution.textContent =
          "确认后将提交恢复。取消此对话框不会写入；已提交的写入不会因关闭视图而回滚。";
        const dialogActions = document.createElement("div");
        dialogActions.className = "restore-actions";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "取消";
        cancel.dataset.testid = "restore-cancel";
        const confirm = document.createElement("button");
        confirm.type = "button";
        confirm.textContent = "确认恢复";
        confirm.dataset.testid = "restore-confirm";
        dialogActions.append(cancel, confirm);
        dialog.append(
          dialogHeading,
          summary,
          dialogTarget,
          caution,
          dialogActions,
        );
        section.append(
          heading,
          description,
          actions,
          status,
          comparison,
          dialog,
        );
        root.append(section);

        const updateButtons = () => {
          refresh.disabled = pending || dialog.open;
          open.disabled = pending || !preview || dialog.open;
          confirm.disabled = pending || !confirmation;
          cancel.disabled = pending;
          section.setAttribute("aria-busy", String(pending));
        };
        const closeDialog = () => {
          confirmation = null;
          dialog.close();
          updateButtons();
          if (!disposed) open.focus();
        };
        const read = async () => {
          if (disposed || pending || dialog.open) return;
          pending = true;
          preview = null;
          status.textContent = "正在读取预览…";
          updateButtons();
          try {
            const next = await service.preview(controller.signal);
            if (disposed) return;
            if (next) {
              const currentJson = JSON.stringify(next.current, null, 2);
              const targetJson = JSON.stringify(next.target, null, 2);
              preview = { ...next };
              currentMeta.textContent = `当前版本 ${next.from} · 修订号 ${next.revision}`;
              targetMeta.textContent = `目标版本 ${next.to}`;
              current.textContent = currentJson ?? "null";
              target.textContent = targetJson ?? "null";
              status.textContent = "预览已读取，请核对后发起恢复。";
            } else {
              currentMeta.textContent = "没有可用于恢复的预览";
              targetMeta.textContent = "无适用快照";
              current.textContent = "—";
              target.textContent = "—";
              status.textContent = "当前没有适用的旧快照，未执行恢复。";
            }
          } catch {
            if (disposed) return;
            status.textContent =
              "读取预览失败。已有显示不代表最新状态，请重新读取。";
          } finally {
            if (!disposed) {
              pending = false;
              refresh.textContent = "重新读取";
              updateButtons();
            }
          }
        };
        const showConfirmation = () => {
          if (disposed || pending || !preview || dialog.open) return;
          confirmation = { ...preview };
          summary.textContent = `以修订号 ${confirmation.revision} 确认：从版本 ${confirmation.from} 恢复到版本 ${confirmation.to}。`;
          dialogTarget.textContent = target.textContent;
          dialog.showModal();
          updateButtons();
          cancel.focus();
        };
        const dismiss = () => {
          if (!disposed && !pending) closeDialog();
        };
        /** @param {Event} event */
        const onEscape = (event) => {
          event.preventDefault();
          dismiss();
        };
        const submit = async () => {
          if (disposed || pending || !confirmation || !dialog.open) return;
          const revision = confirmation.revision;
          pending = true;
          preview = null;
          status.textContent = "正在提交恢复，请等待回执…";
          summary.textContent = `正在提交修订号 ${revision} 的恢复，请勿重复操作。`;
          updateButtons();
          try {
            const receipt = await service.restore(revision, controller.signal);
            if (disposed) return;
            const json = JSON.stringify(receipt.value, null, 2);
            current.textContent = json ?? "null";
            currentMeta.textContent = `已确认恢复回执 · 修订号 ${receipt.revision}`;
            status.textContent = `恢复已确认，修订号 ${receipt.revision}。再次操作前请重新读取。`;
          } catch (error) {
            if (disposed) return;
            const unknown =
              typeof error === "object" &&
              error !== null &&
              "outcome" in error &&
              error.outcome === "unknown";
            status.textContent = unknown
              ? "恢复结果待确认：可能已经写入。请重新读取后核对，不会自动重试。"
              : error instanceof Error && error.message.includes("stale")
                ? "状态已变化，本次确认已过期。请重新读取后再确认。"
                : typeof error === "object" &&
                    error !== null &&
                    "outcome" in error &&
                    error.outcome === "not-committed"
                  ? "恢复请求被拒绝，未提交更改。请重新读取后再操作。"
                  : "恢复未完成。保留现有显示供核对，请重新读取最新状态后再操作。";
          } finally {
            if (!disposed) {
              pending = false;
              confirmation = null;
              dialog.close();
              refresh.textContent = "重新读取";
              updateButtons();
              refresh.focus();
            }
          }
        };
        refresh.addEventListener("click", read);
        open.addEventListener("click", showConfirmation);
        cancel.addEventListener("click", dismiss);
        confirm.addEventListener("click", submit);
        dialog.addEventListener("cancel", onEscape);
        return () => {
          disposed = true;
          controller.abort();
          refresh.removeEventListener("click", read);
          open.removeEventListener("click", showConfirmation);
          cancel.removeEventListener("click", dismiss);
          confirm.removeEventListener("click", submit);
          dialog.removeEventListener("cancel", onEscape);
          if (dialog.open) dialog.close();
          section.remove();
        };
      },
    });
  },
};
