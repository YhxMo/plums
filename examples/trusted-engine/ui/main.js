const el = (id) => document.getElementById(id),
  api = window.plums,
  output = el("output");
let requestId;
const invoke = (name, input = {}) =>
  name === "run"
    ? api.engine.request("local", "run", input, input.requestId)
    : name === "cancel"
      ? api.engine.cancel("local", input.requestId)
      : api.engine[name]("local");
async function status() {
  try {
    const s = await invoke("status");
    el("status").textContent =
      `引擎：${s.state} · ${s.trusted ? "已信任" : "等待信任"}`;
  } catch {
    el("status").textContent = "状态读取失败，可返回管理页检查。";
  }
}
async function action(name, input) {
  try {
    const result = await invoke(name, input);
    output.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    output.textContent = error.message ?? "操作未完成，请检查引擎状态。";
  } finally {
    await status();
  }
}
el("start").onclick = () => action("start");
el("stop").onclick = () => action("stop");
el("run").onclick = async () => {
  try {
    const actions = JSON.parse(el("actions").value);
    if (!Array.isArray(actions)) throw Error("请填写操作数组");
    requestId = "task-" + Date.now();
    el("run").disabled = true;
    await action("run", { actions, mode: el("mode").value, requestId });
  } catch (e) {
    output.textContent = e.message;
  } finally {
    el("run").disabled = false;
  }
};
el("cancel").onclick = () => requestId && action("cancel", { requestId });
api.onEvent((event) => {
  if (event.topic === "engine.event")
    output.textContent += `\n${JSON.stringify(event.data)}`;
  if (event.topic === "engine.status") void status();
});
void status();
