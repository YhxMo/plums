/** @param {HTMLElement} root @param {import('../contracts').Workbench} api */
export function bind(root, api) {
  const input = /** @type {HTMLTextAreaElement} */ (
    root.querySelector("textarea")
  );
  const form = /** @type {HTMLFormElement} */ (root.querySelector("form"));
  const run = /** @type {HTMLButtonElement} */ (
    root.querySelector("[data-run]")
  );
  const cancel = /** @type {HTMLButtonElement} */ (
    root.querySelector("[data-cancel]")
  );
  input.value = api.snapshot().input;
  const render = () => {
    const state = api.snapshot();
    const phases = {
      ready: "就绪",
      running: "处理中…",
      saving: "正在保存，等待提交回执…",
      saved: "已保存",
      cancelled: "已取消，未提交新结果",
      failed: "处理失败",
      uncertain: "保存结果未确认，请重新加载状态",
    };
    root.querySelectorAll("[data-phase]").forEach((node) => {
      node.textContent = phases[state.phase];
    });
    root.querySelectorAll("[data-output]").forEach((node) => {
      node.textContent = state.output || "运行后，结果会出现在这里。";
    });
    root.querySelectorAll("[data-provider]").forEach((node) => {
      node.textContent = state.provider;
    });
    root.querySelectorAll("[data-runs]").forEach((node) => {
      node.textContent = String(state.runs);
    });
    root.querySelectorAll("[data-error]").forEach((node) => {
      node.textContent = state.error ?? "";
    });
    run.disabled = ["running", "saving", "uncertain"].includes(state.phase);
    cancel.disabled = state.phase !== "running";
  };
  const submit = (/** @type {SubmitEvent} */ event) => {
    event.preventDefault();
    void api.run(input.value);
  };
  const stop = () => api.cancel();
  form.addEventListener("submit", submit);
  cancel.addEventListener("click", stop);
  const unsubscribe = api.subscribe(render);
  render();
  return () => {
    unsubscribe();
    form.removeEventListener("submit", submit);
    cancel.removeEventListener("click", stop);
    root.replaceChildren();
  };
}
