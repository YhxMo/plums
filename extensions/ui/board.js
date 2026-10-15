import { bind } from "./bind.js";
/** @type {import('../../modules/sdk').ExtensionDefinition} */
export default {
  manifest: {
    id: "ui.board",
    version: "1.0.0",
    apiVersion: 1,
    requires: { workbench: 1 },
  },
  activate(ctx) {
    ctx.view({
      id: "board",
      label: "画布",
      mount(root) {
        root.innerHTML = `<main class="board"><header class="board-top"><div><span class="eyebrow">画布布局</span><h1>工作画布</h1></div><nav aria-label="画布导航"><a href="#board-input">编辑</a><a href="#board-result">输出</a><a href="#board-status">状态</a></nav></header><div class="board-columns"><section id="board-input" class="board-cell"><span class="step-label">01 / INPUT</span><h2>编辑输入</h2><form><label for="board-text">待处理文本</label><textarea id="board-text" rows="7"></textarea><div class="actions"><button type="submit" data-run>运行并保存</button><button type="button" data-cancel class="secondary">取消任务</button></div></form></section><section id="board-result" class="board-cell board-output"><span class="step-label">02 / OUTPUT</span><h2>处理结果</h2><p class="output" data-output></p><p role="alert" class="error" data-error></p></section><section id="board-status" class="board-cell"><span class="step-label">03 / STATE</span><h2>运行状态</h2><dl><dt>当前服务</dt><dd data-provider></dd><dt>任务状态</dt><dd role="status" data-phase></dd><dt>保存次数</dt><dd data-runs></dd></dl><p>切换布局会保留已保存的输入与结果。</p></section></div></main>`;
        const stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = new URL("./style.css", import.meta.url).href;
        root.prepend(stylesheet);
        return bind(root, ctx.use("workbench"));
      },
    });
  },
};
