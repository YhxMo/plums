const form = document.querySelector("form");
const input = document.querySelector("textarea");
const send = document.querySelector("button");
const status = document.querySelector("#status");
const log = document.querySelector("#messages");
const names = { user: "你", assistant: "测试 Agent", tool: "工具结果" };
function render(messages) {
  log.replaceChildren();
  for (const message of messages) {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    const text = document.createElement("p");
    name.textContent = names[message.role] ?? message.role;
    text.textContent = message.content;
    item.append(name, text);
    log.append(item);
  }
}
const history = () => window.plums.invoke("commands", "history", {});
const failure = (error) =>
  `请求失败：${error.code ?? "FIXTURE_FAILED"}。请在管理页检查组件和权限。`;
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || send.disabled) return;
  input.disabled = send.disabled = true;
  status.textContent = "正在等待回复…";
  try {
    const result = await window.plums.invoke("commands", "chat", { text });
    render(await history());
    status.textContent = result.error
      ? `本次对话停止：${result.error.code}`
      : "回复已保存。";
    input.value = "";
  } catch (error) {
    status.textContent = failure(error);
  } finally {
    input.disabled = send.disabled = false;
    input.focus();
  }
});
history()
  .then((messages) => {
    render(messages);
    status.textContent = messages.length
      ? "记录已恢复。"
      : "发送消息，开始测试对话。";
  })
  .catch((error) => {
    status.textContent = failure(error);
  })
  .finally(() => {
    input.disabled = send.disabled = false;
  });
