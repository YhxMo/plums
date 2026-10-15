import { bind } from "./bind.js";
/** @type {import('../../modules/sdk').ExtensionDefinition} */
export default {
  manifest: {
    id: "ui.default",
    version: "1.0.0",
    apiVersion: 1,
    requires: { workbench: 1 },
  },
  activate(ctx) {
    ctx.view({
      id: "default",
      label: "工作台",
      mount(root) {
        root.innerHTML = `<div class="workspace"><aside class="workspace-nav"><span class="eyebrow">WORKSPACE</span><h2>我的工作台</h2><nav aria-label="工作台导航"><a href="#editor">文本处理</a><a href="#result">最近结果</a></nav><p>界面由扩展提供。<br>布局可以整体替换。</p></aside><main class="workspace-main"><header><span class="eyebrow">LOCAL EXPERIMENT · 01</span><h1>让扩展开始工作。</h1><p>一个服务、一份输入，贯通本地状态与原生能力。</p></header><section id="editor" class="editor-panel"><div class="panel-heading"><h2>输入</h2><span data-provider></span></div><form><label for="text-input">待处理文本</label><textarea id="text-input" rows="4"></textarea><div class="actions"><button data-run type="submit">运行并保存</button><button data-cancel type="button" class="secondary">取消任务</button><span role="status" data-phase></span></div></form><p role="alert" class="error" data-error></p></section><section id="result" class="result-panel"><div class="panel-heading"><h2>最近结果</h2><span>累计完成 <b data-runs>0</b> 次</span></div><p class="output" data-output></p></section></main></div>`;
        const stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = new URL("./style.css", import.meta.url).href;
        root.prepend(stylesheet);
        return bind(root, ctx.use("workbench"));
      },
    });
  },
};
