import { element, listen, panel, action } from "./local-proof-ui.js";

/** Counts code points, not grapheme clusters; original line breaks count too.
 * @param {string} text
 */
export function analyzeText(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const issues = [];
  let paragraphs = 0;
  let nonEmptyLines = 0;
  let inParagraph = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed) {
      nonEmptyLines++;
      if (!inParagraph) paragraphs++;
    }
    inParagraph = Boolean(trimmed);
    if (/[ \t]+$/.test(line)) {
      issues.push({
        line: index + 1,
        kind: "trailing",
        message: "行尾有空格或制表符",
      });
    }
    if (/\b(?:TODO|TBD)\b|待补/i.test(line)) {
      issues.push({
        line: index + 1,
        kind: "placeholder",
        message: "含 TODO / TBD / 待补标记",
      });
    }
    if (trimmed && index > 0 && trimmed === lines[index - 1].trim()) {
      issues.push({
        line: index + 1,
        kind: "duplicate",
        message: "与上一行内容重复（忽略首尾空白）",
      });
    }
  }
  let codePoints = 0;
  let nonWhitespace = 0;
  for (const char of text) {
    codePoints++;
    if (!/\s/u.test(char)) nonWhitespace++;
  }
  return { codePoints, nonWhitespace, nonEmptyLines, paragraphs, issues };
}

/**
 * @param {import("./local-proof-types.js").AuthorContext} ctx
 * @returns {import("./local-proof-types.js").TextNodeService}
 */
export function createTextService(ctx) {
  let text = "";
  const checked = [false, false, false];
  /** @type {Set<() => void>} */
  const subscribers = new Set();
  let mounts = 0;
  let disposals = 0;
  let closed = false;
  const assertOpen = () => {
    if (closed || ctx.signal.aborted) throw Error("本地文本节点已停止");
  };
  const notify = () => {
    for (const subscriber of subscribers) subscriber();
  };
  ctx.onDispose(() => {
    closed = true;
    text = "";
    checked.fill(false);
    subscribers.clear();
  });
  return {
    /** Public example.local-text.node@1: createNode("editor"|"checklist"). */
    createNode(mode) {
      assertOpen();
      if (mode !== "editor" && mode !== "checklist")
        throw Error("未知节点模式");
      return {
        id: `example.local-text.${mode}`,
        mount(root, scope) {
          assertOpen();
          let subscribed = false;
          /** @type {() => void} */
          let unsubscribe = () => {};
          scope.onDispose(() => {
            if (subscribed) {
              unsubscribe();
              disposals++;
            }
          });
          const body = panel(
            root,
            scope,
            mode === "editor" ? "本地文本检查" : "交稿前逐项核对",
            "文本与勾选仅存在于本代扩展内；切页保留，停用或重启清空。所有检查均在本地进行。",
          );
          /** @type {HTMLTextAreaElement | undefined} */
          let input;
          if (mode === "editor") {
            const label = element(
              "label",
              "待检查文本（最多 64,000 个 UTF-16 代码单元）",
            );
            input = element("textarea");
            input.value = text;
            input.maxLength = 64000;
            input.rows = 9;
            input.dataset.pageFocus = "local-proof-text";
            Object.assign(input.style, {
              display: "block",
              width: "100%",
              boxSizing: "border-box",
              padding: "12px",
              font: "inherit",
              color: "inherit",
              backgroundColor: "transparent",
              border: "1px solid var(--control-border, currentColor)",
              borderRadius: "6px",
              resize: "vertical",
              minHeight: "180px",
            });
            label.append(input);
            body.append(label);
            const buttons = element("div");
            Object.assign(buttons.style, {
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
              marginTop: "10px",
            });
            const sample = action("填入检查示例");
            const clear = action("清空文本");
            /** @param {string} value */
            const setText = (value) => {
              assertOpen();
              text = value;
              // A changed draft needs a new manual review.
              checked.fill(false);
              notify();
            };
            const editor = input;
            listen(scope, editor, "input", () => setText(editor.value));
            listen(scope, sample, "click", () =>
              setText("你好 A😀\nTODO  \n\n待补"),
            );
            listen(scope, clear, "click", () => setText(""));
            buttons.append(sample, clear);
            body.append(buttons);
          }
          const stats = element("p");
          stats.setAttribute("role", "status");
          const findingsTitle = element("h3", "检查发现");
          const findings = element("ul");
          body.append(stats, findingsTitle, findings);
          const checks = [
            "已核对标题与正文表达",
            "已核对数字、日期与专有名词",
            "已处理或确认所有检查发现",
          ];
          /** @type {HTMLInputElement[]} */
          const boxes = [];
          const checklist = element("fieldset");
          Object.assign(checklist.style, {
            minWidth: "0",
            borderColor: "var(--control-border, currentColor)",
          });
          checklist.append(element("legend", "交稿清单（文本改变后重置）"));
          checks.forEach((description, index) => {
            const label = element("label");
            Object.assign(label.style, {
              display: "flex",
              alignItems: "center",
              gap: "10px",
              minHeight: "44px",
              padding: "8px 0",
              boxSizing: "border-box",
              cursor: "pointer",
            });
            const box = element("input");
            box.type = "checkbox";
            Object.assign(box.style, { flexShrink: "0", margin: "0" });
            box.dataset.pageFocus = `local-proof-check-${index}`;
            boxes.push(box);
            listen(scope, box, "change", () => {
              assertOpen();
              checked[index] = box.checked;
              notify();
            });
            label.append(box, element("span", description));
            checklist.append(label);
          });
          const completed = element("p");
          body.append(checklist, completed);
          const render = () => {
            const result = analyzeText(text);
            if (input && input.value !== text) input.value = text;
            stats.textContent = `码点数 ${result.codePoints} · 非空白码点 ${result.nonWhitespace} · 非空行 ${result.nonEmptyLines} · 段落 ${result.paragraphs}`;
            const visible = result.issues.slice(0, 60);
            findings.replaceChildren(
              ...visible.map((issue) =>
                element("li", `第 ${issue.line} 行：${issue.message}`),
              ),
            );
            if (!result.issues.length)
              findings.append(
                element(
                  "li",
                  text
                    ? "未发现上述三类问题；仍需人工核对。"
                    : "粘贴文本后开始检查。",
                ),
              );
            if (result.issues.length > visible.length)
              findings.append(
                element(
                  "li",
                  `共 ${result.issues.length} 条，只展示前 60 条。`,
                ),
              );
            boxes.forEach((box, index) => {
              box.checked = checked[index];
            });
            completed.textContent = `已确认 ${checked.filter(Boolean).length} / ${checks.length} 项`;
          };
          // Register cleanup before subscribing or mutating the counter.
          unsubscribe = () => subscribers.delete(render);
          subscribers.add(render);
          subscribed = true;
          mounts++;
          render();
        },
      };
    },
    diagnostics() {
      assertOpen();
      return {
        mounts,
        disposals,
        activeNodes: mounts - disposals,
        subscriptions: subscribers.size,
      };
    },
  };
}

/** @type {import("./local-proof-types.js").ExtensionDefinition} */
const definition = {
  manifest: {
    id: "example.local-text-node",
    version: "0.1.0",
    apiVersion: 1,
    provides: { "example.local-text.node": 1 },
  },
  activate(ctx) {
    ctx.provide("example.local-text.node", 1, createTextService(ctx));
  },
};

export default definition;
