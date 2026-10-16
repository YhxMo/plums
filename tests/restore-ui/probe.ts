import { Host } from "../../modules/extension-host/host";
import { PlatformAdapter } from "../../src/platform";
import {
  restorePreviousState,
  type ExtensionContext,
  type StoredState,
} from "../../modules/sdk";
import panel from "../fixtures/state-restore-panel.js";
import "./style.css";
const host = new Host(new PlatformAdapter());
let ctx!: ExtensionContext;
let mode: "normal" | "reject" | "unknown" | "hold" = "normal";
let release: () => void = () => {};
let attempts = 0;
let settled = 0;
let failRead = false;
const read = () => ctx.platform("state.read") as Promise<StoredState | null>;
const seed = async () => {
  const saved = await read();
  const revision = saved?.revision ?? 0;
  return ctx.platform("state.write", {
    revision,
    value: {
      version: 2,
      data: { labels: ["合成梅子"] },
      previous: {
        revision: Math.max(1, revision),
        value: { version: 1, data: { label: "合成梅子" } },
      },
    },
  });
};
host.install({
  manifest: {
    id: "restore.ui.data",
    version: "1",
    apiVersion: 1,
    capabilities: ["state.read", "state.write"],
    provides: { "sample.restore": 1 },
  },
  activate(context) {
    ctx = context;
    ctx.provide("sample.restore", 1, {
      async preview(signal?: AbortSignal) {
        if (failRead) throw Error("合成读取失败");
        const saved = (await ctx.platform(
          "state.read",
          undefined,
          signal,
        )) as StoredState | null;
        const value = saved?.value as
          | { version: number; data: unknown; previous?: StoredState }
          | undefined;
        if (!saved || !value || value.version !== 2) return null;
        const old = value.previous?.value as
          { version: number; data: { label?: unknown } } | undefined;
        if (old?.version !== 1 || typeof old.data?.label !== "string")
          throw Error("快照校验失败");
        return {
          revision: saved.revision,
          from: 2,
          to: 1,
          current: value.data,
          target: old.data,
        };
      },
      async restore(revision: number, signal?: AbortSignal) {
        attempts++;
        try {
          if (mode === "hold")
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          if (mode === "reject")
            throw Object.assign(Error("合成提交拒绝"), {
              outcome: "not-committed",
            });
          const result = await restorePreviousState(
            ctx,
            {
              revision,
              from: 2,
              to: 1,
              validate: (d) =>
                typeof (d as { label?: unknown })?.label === "string",
            },
            signal,
          );
          if (mode === "unknown")
            throw Object.assign(Error("合成回执丢失"), { outcome: "unknown" });
          return result;
        } finally {
          settled++;
        }
      },
    });
  },
});
host.install(panel);
const root = document.querySelector<HTMLElement>("#workspace")!;
let close: (() => void | Promise<void>) | undefined;
const el = (id: string) =>
  root.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const button = (id: string) => el(id) as HTMLButtonElement;
const assert = (v: unknown, label: string) => {
  if (!v) throw Error(label);
};
async function until(check: () => boolean) {
  const end = Date.now() + 4000;
  while (!check()) {
    assert(Date.now() < end, "timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}
async function preview() {
  button("restore-refresh").click();
  await until(() => !button("restore-open").disabled);
}
async function confirm() {
  button("restore-open").click();
  await until(() => !!root.querySelector<HTMLDialogElement>("dialog")?.open);
  button("restore-confirm").click();
}
async function run() {
  const checks: string[] = [];
  try {
    const initial = (await read())!.revision;
    failRead = true;
    button("restore-refresh").click();
    await until(() => !button("restore-refresh").disabled);
    assert(
      button("restore-open").disabled &&
        /读取预览失败/.test(el("restore-status").textContent!),
      "read failure visible",
    );
    failRead = false;
    await preview();
    assert((await read())!.revision === initial, "preview no write");
    checks.push("preview-does-not-write");
    button("restore-open").click();
    button("restore-cancel").click();
    assert(
      (await read())!.revision === initial &&
        document.activeElement === button("restore-open"),
      "cancel preserves and focuses",
    );
    checks.push("cancel-no-write-focus-return");
    await seed();
    await confirm();
    await until(() => !button("restore-refresh").disabled);
    assert(
      button("restore-open").disabled &&
        (await read())!.revision === initial + 1,
      "stale rejected",
    );
    assert(
      /过期|状态已变化/.test(el("restore-status").textContent!),
      "stale explanation",
    );
    checks.push("stale-confirmation-requires-reread");
    await preview();
    mode = "reject";
    const before = (await read())!.revision;
    await confirm();
    await until(() => !button("restore-refresh").disabled);
    assert(
      button("restore-open").disabled && (await read())!.revision === before,
      "reject preserves",
    );
    assert(
      /拒绝/.test(el("restore-status").textContent!),
      "rejection explanation",
    );
    checks.push("rejected-write-visible-and-preserved");
    await preview();
    mode = "hold";
    const startAttempts = attempts;
    await confirm();
    await until(() => attempts === startAttempts + 1);
    button("restore-confirm").click();
    assert(
      attempts === startAttempts + 1 && button("restore-confirm").disabled,
      "pending no duplicate",
    );
    mode = "normal";
    release();
    await until(() => !button("restore-refresh").disabled);
    assert(
      (await read())!.revision === before + 1 &&
        /恢复/.test(el("restore-status").textContent!),
      "confirmed write",
    );
    checks.push("explicit-confirmation-once-and-success");
    await seed();
    await preview();
    mode = "unknown";
    const uncertain = (await read())!.revision;
    await confirm();
    await until(() => !button("restore-refresh").disabled);
    assert(
      button("restore-open").disabled &&
        /待确认|未知|确认结果/.test(el("restore-status").textContent!) &&
        (await read())!.revision === uncertain + 1,
      "unknown locked despite commit",
    );
    checks.push("unknown-receipt-locks-without-false-failure");
    mode = "normal";
    button("restore-refresh").click();
    await until(() => !button("restore-refresh").disabled);
    assert(button("restore-open").disabled, "no eligible after reread");
    checks.push("reread-confirms-no-applicable-older-target");
    await seed();
    await preview();
    mode = "hold";
    const lastAttempt = attempts;
    await confirm();
    await until(() => attempts === lastAttempt + 1);
    const revision = (await read())!.revision;
    await close!();
    release();
    await until(() => settled === attempts);
    assert(
      root.childNodes.length === 0 && (await read())!.revision === revision,
      "closed UI cannot commit or render late",
    );
    checks.push("unmount-cancels-pending-and-ignores-late-ui");
    document.querySelector("#result")!.textContent = JSON.stringify(
      {
        passed: true,
        checks,
        platform: new PlatformAdapter().kind,
        limitations:
          "Synthetic provider faults; native storage normal commit only; no real-data restoration",
      },
      null,
      2,
    );
  } catch (error) {
    document.querySelector("#result")!.textContent = JSON.stringify({
      passed: false,
      checks,
      error: String(error),
    });
  }
}
const runButton = document.querySelector<HTMLButtonElement>("#run")!;
runButton.disabled = true;
runButton.onclick = () => {
  runButton.disabled = true;
  void run();
};
void (async () => {
  await host.grant("restore.ui.data", ["state.read", "state.write"]);
  await host.start("restore.ui.data");
  if (!(await read()))
    await ctx.platform("state.write", {
      revision: 0,
      value: { version: 1, data: { label: "seed" } },
    });
  await seed();
  await host.start("sample.restore-panel");
  close = host.mountView("sample.restore-panel", root);
  runButton.disabled = false;
})();
