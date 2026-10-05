const status = document.querySelector("#status");
function render(notes) {
  for (const section of ["todo", "done"]) {
    const target = document.querySelector("#" + section);
    target.replaceChildren();
    const items = notes.filter((n) => n.done === (section === "done"));
    document.querySelector("#" + section + "-count").textContent = items.length;
    for (const n of items) {
      const button = document.createElement("button");
      button.className = "note";
      button.textContent = n.text;
      button.onclick = () => run("toggle", { id: n.id });
      target.append(button);
    }
  }
}
async function run(name, input) {
  status.textContent = "等待确认或执行…";
  try {
    render(await window.plums.invoke("commands", name, input));
    status.textContent = "";
  } catch (error) {
    status.textContent = error.message || "操作未完成。";
  }
}
document.querySelector("#manager").onclick = () => window.plums.openManager();
document.querySelector("form").onsubmit = async (event) => {
  event.preventDefault();
  await run("add", { text: document.querySelector("#text").value });
  document.querySelector("#text").value = "";
};
run("load", {});
