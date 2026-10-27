# 写你的第一个 Plums 扩展

状态：当前有效（2026-10-24 核实）；SDK 仍是实验版本，接口可能变化。

Plums 的扩展是**一个文件夹，里面两个文件**：`manifest.json` 说明扩展是谁、需要什么，`main.js` 是代码。把文件夹（或它的 zip）导入 Plums，在扩展管理里启用，它就能作为 Agent 可选的模型、添加界面、保存数据或连接真实模型服务。你只需要一个文本编辑器和 Plums 应用（Mac，或开发者的浏览器预览）。不需要 Node.js、npm 或构建工具。

## 1. 从模板开始

下载 [起步模板](../extensions/examples/starter-model/) 文件夹（[manifest.json](../extensions/examples/starter-model/manifest.json) 与 [main.js](../extensions/examples/starter-model/main.js)）。它是一个不联网的本地“模型”：Agent 选中它后，回复由它生成——统计字数后回显你的消息。用编辑器打开 `manifest.json`，把 `id` 改成你自己的，例如 `yourname.echo`。ID 以小写字母开头，只含小写字母、数字、点和连字符。

两个文件的骨架：

```json
{
  "id": "yourname.echo",
  "version": "0.1.0",
  "apiVersion": 1,
  "provides": { "chat": 1 }
}
```

```js
// main.js
export default {
  activate(ctx) {
    ctx.provide("chat", 1, {
      name: "回声",
      models: () => [{ id: "echo", label: "回声", description: "本地回声，不联网。" }],
      subscribe: () => () => {},
      async reply({ input }, signal) {
        signal.throwIfAborted();
        return "你说：" + input;
      },
    });
  },
};
```

`manifest.json` 说明扩展是谁、提供和需要什么；可选的 `name`（最多 40 字）在扩展管理中代替 ID 显示，`author`（最多 80 字）在导入确认页显示作者，`description`（纯文本，最多 500 字，保留换行）显示在导入确认页和扩展详情里。`main.js` 默认导出 `{ activate }`，`activate(ctx)` 在启用时运行，通过 `ctx` 使用 Plums 的能力。导入时只读取 `manifest.json`，确认导入后才执行 `main.js`；文件顶层只放声明（常量、函数），不要读写数据、改页面或联网，真正的工作放进 `activate`。

`models()` 列出用户可以为 Agent 选择的模型；`reply` 收到所选模型的 `id`、Agent 的系统提示词（`instructions`：它的名字、当天日期与设定，不含给人看的介绍）、此前的对话（`history`）和这条消息（`input`），必须返回字符串，最长 1,000,000 个字符；抛出的错误会作为失败显示给用户。模型列表会变化时，调用 `subscribe` 收到的回调通知界面。

## 2. 导入并启用

1. 点窄栏（手机为顶栏）的“扩展”→ 安装扩展。
2. 点「选择文件夹」选中扩展所在的文件夹，或点「选择扩展包」选它的 zip（也可以同时选中 `manifest.json` 和 `main.js` 两个文件）；也可以把文件夹或 zip 拖进对话框。
3. 核对名称、作者、说明和需要的权限（扩展 ID、版本、服务与来源在「技术详情」里），点「导入」。这时 `main.js` 才会执行。扩展导入后是停用的，列表中显示 `name`，没有写时显示 ID。
4. 在列表中启用你的扩展。声明了权限的扩展会弹出确认，点「授权并启动」。
5. 点「返回工作区」，选择或添加一个 Agent，在输入框下方的模型选择中选你的模型，发一条消息。每个 Agent 单独选择模型；新建的 Agent 默认使用列表中的第一个。还没有任何模型时，Agent 会提示先连接一个。
6. 启用状态和授权会自动保留，下次打开应用时扩展仍然启用。扩展版本变化或重新导入文件后，声明了权限的扩展需要重新确认。

改完代码后，再次导入同一个文件夹或 zip，按「替换」即可。旧版本会先停用，你的扩展数据会保留；替换后需要重新启用、确认权限；启用与授权会自动保存；导入后加载失败的扩展，也用这种方式修好后重新导入。

## 3. 扩展能做什么

| 想做的事 | 怎么写 | 参考 |
| --- | --- | --- |
| 提供 Agent 可选的模型 | `provides: { chat: 1 }`，`ctx.provide` 一个含 `name`、`models()`、`subscribe`、`reply(request, signal)` 的对象；有自己的添加模型页面时用 `manage` 给出该 `dialog` 视图的 id，Agent 界面会从“添加模型连接”打开它 | 起步模板、[回显模型](../extensions/services/echo-chat/main.js)（仅开发构建）、[接口](../extensions/contracts.d.ts)、[模型连接](MODELS.md#chat1) |
| 添加一个界面 | `ctx.view(...)`，见下方示例 | [界面契约](EXTENSION-CONTRACTS.md#界面组合与替换) |
| 保存数据 | 声明 `capabilities: ["state.read", "state.write"]`，见下方示例 | [状态规则](SDK-AUTHORING.md#状态取消与演进) |
| 保存很多条目（如聊天记录）并搜索 | 声明 `state.batch` 与 `records.list`，要搜索再加 `records.search` | [批量写与记录](SDK-AUTHORING.md#状态取消与演进) |
| 让用户调整设置 | `manifest.configuration` 声明字段，`ctx.configuration` 读取；用户在扩展管理中修改 | [配置契约](EXTENSION-CONFIGURATION.md) |
| 读取公开资源 | 声明 `capabilities: ["network.read"]` 与 `networkSources: ["https://…"]`，用 `ctx.platform("network.read", { version: 1, url })` GET 声明来源下的地址，不带密钥 | [公开网络读取](NETWORK-READ.md) |
| 在浏览器中打开链接 | 声明 `capabilities: ["link.open"]`，用 `ctx.platform("link.open", { version: 1, url })` 打开 `https://` 地址 | [平台能力](EXTENSION-CONTRACTS.md#平台能力与可选助手) |
| 让用户保存一个文件 | 声明 `capabilities: ["file.save"]`，用 `ctx.platform("file.save", { version: 1, name, data })` 弹出保存面板（PNG 或 `.plums`，base64） | [平台能力](EXTENSION-CONTRACTS.md#平台能力与可选助手) |
| 连接真实模型 | 声明 `credentialBindings` 和 `capabilities: ["credential.request"]`，用 `ctx.platform("credential.request", { version: 1, binding, body })` 发请求；API Key 由用户在扩展详情中填写，扩展读不回密钥 | [请求契约](CREDENTIAL-REQUEST.md)；要让用户自建多条连接见[扩展自建连接](CREDENTIAL-BINDINGS.md#扩展自建连接) |
| 让扩展管理显示谁在用 | `ctx.shell.publishUsers("Agent", [{ id, label, uses }], toggle)`；停用时自动清除 | [页面契约](PAGES.md#让扩展使用宿主入口) |
| 使用别的扩展提供的服务 | `requires: { "服务名": 版本 }`，`ctx.use("服务名")` 取一个，`ctx.providers("服务名")` 列出全部；没有提供者也要能启用时改用 `optional: { "服务名": 版本 }`，只能用 `ctx.providers` | [事件样板](../extensions/examples/events/main.js) |

**界面**：`id` 在所有扩展中唯一，用你的扩展 ID 即可。默认（`presentation: "workspace"`）在 设置 →「界面布局」中选「使用 + label」后占据整个工作区，取代 Agent 界面，并在窄栏显示 `icon`（可选的单色 SVG，规则见[页面契约](PAGES.md)）；`"dialog"` 在扩展管理里本扩展的详情中打开，`"sidebar"` 出现在右侧栏。`root` 是一个空容器，应用的字体、颜色和按钮样式会作用于其中的普通元素。

```js
ctx.view({
  id: "yourname.hello",
  label: "你好",
  mount(root) {
    const p = document.createElement("p");
    p.textContent = "你好，Plums";
    root.append(p);
    return () => p.remove(); // 停用时清理
  },
});
```

**数据**：每个扩展有一份自己的数据，最大 1 MiB（按保存后的 JSON 计）。`value` 可以是任意 JSON。写入时传入读取时得到的 `revision`（还没有数据时为 `0`），成功后返回新的 `{ revision, value }`；如果期间数据被改过，写入会被拒绝，原数据不变，重新读取后再写即可。

```js
const saved = await ctx.platform("state.read"); // null 或 { revision, value }
let revision = saved?.revision ?? 0;
const notes = saved?.value?.notes ?? [];
notes.push("新的一条");
const receipt = await ctx.platform("state.write", { revision, value: { notes } });
revision = receipt.revision; // 下次写入用它
```

写入失败时，错误的 `outcome` 为 `"not-committed"` 或错误名为 `AbortError` 表示确定没写入；其他情况（例如应用正在退出）结果未知，下次写入前先重新读取。

所有监听、定时器和 DOM 都要在停用时清理：`mount` 返回清理函数，其他资源用 `ctx.onDispose(() => …)`。耗时操作要检查 `signal`。

## 4. 出错时

- **导入时报错**：通常是 `manifest` 不合法，例如缺少 `id`、`version` 或 `apiVersion: 1`，或者 ID 与内置扩展重复。
- **启用后显示「激活失败」**：`activate` 抛出了错误，在扩展管理中选中它查看原因。
- **显示「等待条件」**：你需要的服务没有任何扩展在提供，或者权限尚未确认。
- **看日志**：在窗口内右键 → 检查元素。

## 5. 目前的限制

- `main.js` 只能是一个文件，最大 3 MiB；`manifest.json` 最大 64 KiB。`main.js` 里不能 `import` 文件夹中的其他文件或 npm 包，需要的代码请写在同一文件中（可以用打包工具合并）。文件夹里的其他文件会被忽略。
- 编辑器类型提示需要仓库里的 [SDK 类型](../modules/sdk/index.ts) 和 [服务接口](../extensions/contracts.d.ts)；单独使用模板时可删掉 `@type` 注释。
- 扩展与应用在同一环境中运行，没有沙箱。只导入你信任的扩展，也只把你的扩展交给信任你的人。
- 替换一个连接模型的扩展后，来源会变化，需要在扩展详情中重新填写 API Key。
- 浏览器预览中不能调用真实模型，要在 Mac 应用中试。

开发样板与进阶规则见 [SDK 参考](SDK-AUTHORING.md)，各项能力的完整契约见[扩展契约](EXTENSION-CONTRACTS.md)，类型定义在 [modules/sdk/index.ts](../modules/sdk/index.ts)。
