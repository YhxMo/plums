/** @type {import('../../../modules/sdk').ExtensionMain} */
export default {
  async activate(ctx) {
    /** @type {import('../../contracts').Transformer} */
    const processor = ctx.use("text.transform");
    /** @type {import('../../../modules/sdk').StoredState | null} */
    const saved =
      /** @type {import('../../../modules/sdk').StoredState | null} */ (
        await ctx.platform("state.read")
      );
    let revision = saved?.revision ?? 0;
    /** @type {import('../../contracts').WorkbenchSnapshot} */
    let state = {
      input: "Build something unexpected.",
      output: "",
      runs: 0,
      phase: "ready",
      error: null,
      provider: processor.name,
    };
    if (saved) {
      const value =
        /** @type {Partial<import('../../contracts').WorkbenchSnapshot> & { version?: number }} */ (
          saved.value
        );
      if (
        !value ||
        value.version !== 1 ||
        typeof value.input !== "string" ||
        typeof value.output !== "string" ||
        !Number.isInteger(value.runs) ||
        Number(value.runs) < 0
      )
        throw new Error("工作台状态版本或内容无效；保留原数据");
      state = {
        ...state,
        input: value.input,
        output: value.output,
        runs: Number(value.runs),
      };
    }
    /** @type {Set<() => void>} */
    const listeners = new Set();
    /** @type {AbortController | null} */
    let current = null;
    const notify = () => {
      for (const listener of listeners) listener();
    };
    /** @type {import('../../contracts').Workbench} */
    const api = {
      snapshot: () => state,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      cancel() {
        current?.abort();
      },
      async run(input) {
        if (current || state.phase === "uncertain")
          throw Error("工作台正在运行或保存结果待核对，本次请求未执行。");
        let writing = false;
        const operation = new AbortController();
        current = operation;
        state = { ...state, input, phase: "running", error: null };
        notify();
        try {
          await ctx.task(async (signal) => {
            const abort = () => operation.abort();
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) operation.abort();
            try {
              const output = await processor.transform(input, operation.signal);
              operation.signal.throwIfAborted();
              const value = { version: 1, input, output, runs: state.runs + 1 };
              state = { ...state, phase: "saving" };
              notify();
              writing = true;
              const result =
                /** @type {import('../../../modules/sdk').StoredState} */ (
                  await ctx.platform(
                    "state.write",
                    { revision, value },
                    operation.signal,
                  )
                );
              revision = result.revision;
              state = { ...state, ...value, phase: "saved", error: null };
            } finally {
              signal.removeEventListener("abort", abort);
            }
          });
        } catch (error) {
          const failure = /** @type {{name?: string, outcome?: string}} */ (
            error ?? {}
          );
          const provenNotCommitted =
            !writing ||
            failure.name === "AbortError" ||
            failure.outcome === "not-committed";
          const cancelled = operation.signal.aborted && provenNotCommitted;
          state = {
            ...state,
            phase: !provenNotCommitted
              ? "uncertain"
              : cancelled
                ? "cancelled"
                : "failed",
            error: !provenNotCommitted
              ? "保存结果未确认，请停用后重新启用工作台读取实际状态。"
              : cancelled
                ? null
                : String(error),
          };
        } finally {
          current = null;
          notify();
        }
      },
    };
    ctx.on("workbench.request", (data) => {
      if (typeof data === "string")
        void api.run(data).catch(() => {
          // Event-driven duplicates are rejected before execution; state keeps the phase.
        });
    });
    ctx.onDispose(() => {
      current?.abort();
      listeners.clear();
    });
    ctx.provide("workbench", 1, api);
  },
};
