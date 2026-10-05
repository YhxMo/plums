const messages = document.querySelector("#messages"),
  status = document.querySelector("#status");
function add(role, text) {
  const item = document.createElement("article");
  item.className = role;
  const label = document.createElement("small");
  label.textContent = role === "user" ? "你" : "Agent";
  const content = document.createElement("div");
  content.textContent = text;
  item.append(label, content);
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}
document.querySelector("#manager").onclick = () => window.plums.openManager();
document.querySelector("form").onsubmit = async (event) => {
  event.preventDefault();
  const input = document.querySelector("#text"),
    button = document.querySelector("#send");
  const text = input.value.trim();
  if (!text) return;
  document.querySelector(".welcome")?.remove();
  add("user", text);
  input.value = "";
  button.disabled = true;
  status.textContent = "运行中；如出现授权窗口，请确认这次请求。";
  try {
    const result = await window.plums.invoke("commands", "chat", { text });
    add("assistant", result.text);
    status.textContent = "";
  } catch (error) {
    status.textContent = error.message || "调用未完成，请检查连接器配置。";
  } finally {
    button.disabled = false;
  }
};
window.plums
  .invoke("commands", "history", {})
  .then((history) => {
    if (history.length) document.querySelector(".welcome")?.remove();
    for (const m of history) add(m.role, m.content);
  })
  .catch(() => {});
