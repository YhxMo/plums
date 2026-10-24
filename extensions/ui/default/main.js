import { bind } from "../bind.js";
/** @type {import('../../../modules/sdk').ExtensionMain} */
export default {
  activate(ctx) {
    ctx.view({
      id: "default",
      label: "工作台",
      mount(root) {
        root.innerHTML = `<main class="workspace"><header class="workspace-heading"><div><span class="eyebrow">文本处理</span><h1>文本工作台</h1><p>输入一段文本，用当前服务处理并保存到本地。</p></div><nav aria-label="工作台导航"><a href="#editor">输入</a><a href="#result">最近结果</a></nav></header><div class="workspace-content"><section id="editor" class="editor-panel"><div class="panel-heading"><h2>输入</h2><span class="provider-badge" data-provider></span></div><form><label for="text-input">待处理文本</label><textarea id="text-input" rows="4" spellcheck="false"></textarea><div class="actions"><button data-run type="submit">运行并保存</button><button data-cancel type="button" class="secondary">取消任务</button></div><p role="status" class="task-phase" data-phase></p></form><p role="alert" class="error" data-error></p></section><section id="result" class="result-panel"><div class="panel-heading"><h2>最近结果</h2><span>已完成 <b data-runs>0</b> 次</span></div><p class="output" data-output></p><p class="result-note">成功回执确认保存；停止扩展后仍保留已保存结果。</p></section></div></main>`;
        const stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = new URL("../style.css", import.meta.url).href;
        root.prepend(stylesheet);
        return bind(root, ctx.use("workbench"));
      },
    });
  },
};
