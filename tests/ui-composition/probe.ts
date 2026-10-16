import "./style.css";
import { Host } from "../../modules/extension-host/host";
import { PlatformAdapter } from "../../src/platform";
import { createPanel } from "../fixtures/author-ui-panel";
import { createBoard } from "../fixtures/author-ui-board";
type Control = {
  setMode(
    mode: "normal" | "cycle" | "conflict" | "throw" | "cleanup-fail",
  ): void;
  inspect(): { ready: number; failed: number; closed: number };
};
type Panel = { inspect(): { clicks: number; live: number; closed: number } };
const host = new Host(new PlatformAdapter());
const workspace = document.querySelector<HTMLElement>("#workspace")!;
const management = document.querySelector<HTMLElement>("#management")!;
const output = document.querySelector<HTMLElement>("#result")!;
let control: Control | undefined, panel: Panel | undefined;
let unmount: (() => void | Promise<void>) | undefined;
const checks: string[] = [];
function assert(v: unknown, label: string): asserts v {
  if (!v) throw Error(label);
}
async function until(check: () => boolean) {
  const start = performance.now();
  while (!check()) {
    assert(performance.now() - start < 3000, "condition timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}
function mount() {
  unmount = host.mountView("composition.board", workspace);
}
async function release() {
  await unmount?.();
  unmount = undefined;
}
document.querySelector("#manage")!.addEventListener("click", () => {
  management.hidden = false;
  workspace.hidden = true;
  const dirty = host.inspect("ui.board.author").status === "cleanup-failed";
  (document.querySelector("#restore") as HTMLButtonElement).disabled = dirty;
  document.querySelector("#status")!.textContent = dirty
    ? "清理未完成，请重新启动实验应用。"
    : "";
  management.querySelector("h1")!.setAttribute("tabindex", "-1");
  (management.querySelector("h1") as HTMLElement).focus();
});
async function restore() {
  await release();
  await host.start("ui.panel.author");
  await host.start("ui.board.author");
  control!.setMode("normal");
  mount();
  await until(() => !!workspace.querySelector('[data-testid="counter"]'));
  management.hidden = true;
  workspace.hidden = false;
  document.querySelector("#status")!.textContent = "组合已恢复";
}
document.querySelector("#restore")!.addEventListener("click", () => {
  void restore().catch((e) => {
    document.querySelector("#status")!.textContent = String(e);
  });
});
async function run() {
  try {
    await until(() => !!workspace.querySelector('[data-testid="counter"]'));
    const retainedPanel = panel!;
    const button = workspace.querySelector<HTMLButtonElement>(
      '[data-testid="counter"] button',
    )!;
    button.click();
    assert(retainedPanel.inspect().clicks === 1, "counter action");
    checks.push("two-author-service-composition-and-click");
    assert(
      workspace.querySelector('[data-testid="panel-slot"]')?.contains(button),
      "nested child absent",
    );
    checks.push("nested-contribution-rendered");
    for (const mode of ["cycle", "conflict", "throw"] as const) {
      await release();
      const before = control!.inspect().failed;
      control!.setMode(mode);
      mount();
      await until(() => control!.inspect().failed > before);
      assert(
        !!workspace.querySelector('[role="alert"]'),
        "failure fallback absent",
      );
      assert(panel!.inspect().live === 0, "failed mount leaked panel");
      document.querySelector<HTMLButtonElement>("#manage")!.click();
      assert(!management.hidden, "management unavailable");
      await restore();
      assert(panel!.inspect().live === 1, "recovery duplicate mount");
      checks.push(mode + "-rejects-cleans-and-recovers");
    }
    const stopped = panel!;
    await host.stop("ui.panel.author");
    assert(stopped.inspect().live === 0, "provider stop leaked");
    assert(
      !host.views().some((v) => v.id === "composition.board"),
      "dependent view remains",
    );
    assert(
      !workspace.querySelector('[data-testid="counter"]'),
      "stopped DOM remains",
    );
    checks.push("provider-stop-releases-dependent-tree");
    document.querySelector<HTMLButtonElement>("#manage")!.click();
    assert(!management.hidden, "manager lost");
    await restore();
    assert(panel!.inspect().live === 1, "restart duplicate");
    checks.push("management-restores-single-tree");
    await release();
    control!.setMode("cleanup-fail");
    const before = control!.inspect().ready;
    mount();
    await until(() => control!.inspect().ready > before);
    const failed = await host.stop("ui.board.author").then(
      () => false,
      () => true,
    );
    assert(
      failed && host.inspect("ui.board.author").status === "cleanup-failed",
      "cleanup false success",
    );
    await host.start("ui.board.author").then(
      () => {
        throw Error("dirty restart accepted");
      },
      () => {},
    );
    document.querySelector<HTMLButtonElement>("#manage")!.click();
    assert(!management.hidden, "dirty manager unavailable");
    assert(
      document.querySelector("#status")!.textContent?.includes("清理未完成") &&
        (document.querySelector("#restore") as HTMLButtonElement).disabled,
      "dirty recovery status misleading",
    );
    checks.push("cleanup-failure-latched-with-management-access");
    output.textContent = JSON.stringify(
      {
        passed: true,
        checks,
        limitations:
          "Trusted fixed-tree fixture; no real touch or automatic Host async mount fallback",
      },
      null,
      2,
    );
  } catch (error) {
    output.textContent = JSON.stringify(
      { passed: false, checks, error: String(error) },
      null,
      2,
    );
  }
}
document.querySelector("#run")!.addEventListener("click", () => {
  (document.querySelector("#run") as HTMLButtonElement).disabled = true;
  void run();
});
async function setup() {
  host.install(createPanel());
  host.install(createBoard());
  host.install({
    manifest: {
      id: "ui.probe.reader",
      version: "1",
      apiVersion: 1,
      requires: { "ui.board.control": 1, "ui.panel": 1 },
    },
    activate(ctx) {
      control = ctx.use("ui.board.control");
      panel = ctx.use("ui.panel");
      ctx.onDispose(() => {
        control = undefined;
        panel = undefined;
      });
    },
  });
  await host.start("ui.panel.author");
  await host.start("ui.board.author");
  await host.start("ui.probe.reader");
  mount();
}
void setup().catch((error) => {
  output.textContent = JSON.stringify({ passed: false, error: String(error) });
});
