/** @type {import("../../modules/sdk").ExtensionDefinition} */
const extension = {
  manifest: {
    id: "sample.documents",
    version: "1.0.0",
    apiVersion: 1,
    capabilities: ["document.read"],
  },
  activate(ctx) {
    ctx.view({
      id: "sample.documents",
      label: "文档只读样板",
      mount(root) {
        const section = document.createElement("section");
        section.innerHTML =
          '<h2>读取本次选择的文档</h2><p>先在扩展管理中为此扩展选择文档，再刷新列表。只读、每次最多64 KiB，停用后句柄失效。</p><button type="button">刷新文档列表</button><label style="display:block;margin:12px 0">文档 <select aria-label="文档"></select></label><button type="button">读取文档</button> <button type="button">取消读取</button><p role="status"></p><pre style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>';
        root.append(section);
        const [refresh, read, cancel] = section.querySelectorAll("button");
        const select = /** @type {HTMLSelectElement} */ (
            section.querySelector("select")
          ),
          status = /** @type {HTMLElement} */ (
            section.querySelector('[role="status"]')
          ),
          output = /** @type {HTMLElement} */ (section.querySelector("pre"));
        let disposed = false;
        /** @type {AbortController | null} */
        let controller = null;
        const alive = new AbortController();
        /** @param {string} text */
        const show = (text) => {
          if (!disposed) status.textContent = text;
        };
        async function list() {
          try {
            const items =
              /** @type {import("../../modules/sdk").SelectedDocument[]} */ (
                await ctx.platform("document.read", { action: "list" })
              );
            if (disposed) return;
            select.replaceChildren(
              ...items.map((item) => {
                const o = document.createElement("option");
                o.value = item.handle;
                o.textContent = item.name;
                return o;
              }),
            );
            output.textContent = "";
            show(
              items.length
                ? `可读取 ${items.length} 个文档。`
                : "尚未选择文档，请到扩展管理中选择。",
            );
          } catch {
            show("文档列表读取失败，请核对授权或重新启用。");
          }
        }
        refresh.addEventListener("click", () => void list(), {
          signal: alive.signal,
        });
        read.addEventListener(
          "click",
          async () => {
            if (controller) return;
            if (!select.value) {
              show("请先选择一个已授权的文档。");
              return;
            }
            controller = new AbortController();
            read.disabled = true;
            output.textContent = "";
            show("正在只读访问…");
            try {
              const result =
                /** @type {import("../../modules/sdk").SelectedDocumentResponse} */ (
                  await ctx.platform(
                    "document.read",
                    { handle: select.value, maxBytes: 65536 },
                    controller.signal,
                  )
                );
              if (disposed) return;
              if (result.status === "read") {
                output.textContent = result.text;
                show(`读取成功：${result.bytes} 字节。`);
              } else if (result.status === "cancelled")
                show("已取消读取，没有交付新文本。");
              else if (result.status === "unknown")
                show("读取结果待确认，没有自动重试。");
              else
                show(
                  /** @type {Record<string,string>} */ ({
                    "too-large": "文档超过64 KiB，未读取内容。",
                    encoding: "文档不是有效UTF-8文本。",
                    io: "文档读取失败，可能已移动或不可访问。",
                    denied: "文档授权已失效，请重新选择。",
                  })[result.reason] ?? "读取被拒绝，请核对授权和资源限制。",
                );
            } catch {
              show(
                ctx.signal.aborted ? "扩展已停用。" : "读取失败，请核对授权。",
              );
            } finally {
              controller = null;
              if (!disposed) read.disabled = false;
            }
          },
          { signal: alive.signal },
        );
        cancel.addEventListener("click", () => controller?.abort(), {
          signal: alive.signal,
        });
        void list();
        return () => {
          disposed = true;
          alive.abort();
          controller?.abort();
          section.remove();
        };
      },
    });
  },
};

export default extension;
