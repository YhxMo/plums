# 写你的第一个 Plums 扩展

状态：当前有效（2026-10-19 核实）；SDK 仍是实验版本，接口可能变化。

Plums 的扩展是**一个 .js 文件**。把文件导入 Plums，在扩展管理里启用，它就能给 Agent 提供回复、添加界面、保存数据或连接模型。你只需要一个文本编辑器和 Plums 应用（Mac、Android，或开发者的浏览器预览）。不需要 Node.js、npm 或构建工具。

## 1. 从模板开始

下载 [起步模板](../extensions/examples/starter-text-service.js)。它给默认 Agent 提供回复：统计字数后回显你的消息。用编辑器打开，把 `id` 改成你自己的，例如 `yourname.echo`。ID 以小写字母开头，只含小写字母、数字、点和连字符。

文件的骨架：

```js
export default {
  manifest: {
    id: "yourname.echo",
    version: "0.1.0",
    apiVersion: 1,
    provides: { "text.transform": 1 },
  },
  activate(ctx) {
    ctx.provide("text.transform", 1, {
      name: "回声",
      description: "本地回声，不联网。",
      async transform(input, signal) {
        signal.throwIfAborted();
        return "你说：" + input;
      },
    });
  },
};
```

`manifest` 说明扩展是谁、提供和需要什么；可选的 `name`（最多 40 字）在扩展管理中代替 ID 显示，`description`（纯文本，最多 500 字，保留换行）显示在导入确认页和扩展详情里。`activate(ctx)` 在启用时运行，通过 `ctx` 使用 Plums 的能力。文件顶层只放声明（常量、函数），不要读写数据、改页面或联网：选择文件时代码就会执行，真正的工作放进 `activate`。

`transform` 必须返回字符串，最长 32,000 个字符；抛出的错误会作为失败显示给用户。

## 2. 导入并启用

1. 打开 应用菜单 → 扩展管理 → 安装扩展。
2. 点「选择扩展文件」，或在电脑上把文件拖进对话框。Android 上，先把文件放到设备里，例如「下载」目录。
3. 核对 ID、服务、权限和来源，点「导入」。扩展导入后是停用的，列表中显示 `name`，没有写时显示 ID。
4. 在列表中启用你的扩展。声明了权限的扩展会弹出确认，点「授权并启动」。多个文本服务可以同时启用，并按 Agent 单独开关：新建的 Agent 默认只开启最早启用的那个；要让某个 Agent 使用你的扩展，在 Agent 详情的「组成扩展」里打开它的开关，或在扩展管理中选中你的扩展，点按详情里的 Agent 气泡。同一 Agent 开启多个文本服务时，回复按开启先后依次经过它们。
5. 点「返回工作区」，选择或添加一个 Agent，发一条消息。应用本身不带文本服务；没有启用任何文本服务时，Agent 会提示先去扩展管理启用一个。
6. 启用状态和授权会自动保留，下次打开应用时扩展仍然启用。扩展版本变化或重新导入文件后，声明了权限的扩展需要重新确认。

改完代码后，再次导入同一个文件，按「替换」即可。旧版本会先停用，你的扩展数据会保留；替换后需要重新启用、确认权限，并再次保存组合；导入后加载失败的扩展，也用这种方式修好后重新导入。

## 3. 扩展能做什么

| 想做的事 | 怎么写 | 参考 |
| --- | --- | --- |
| 给 Agent 提供回复 | `provides: { "text.transform": 1 }`，`ctx.provide` 一个含 `name`、`description`、`transform(input, signal)` 的对象 | 起步模板、[大写服务](../extensions/services/upper.js)（仅开发构建）、[接口](../extensions/contracts.d.ts) |
| 添加一个界面 | `ctx.view(...)`，见下方示例 | [界面契约](VIEW-TREE.md) |
| 保存数据 | 声明 `capabilities: ["state.read", "state.write"]`，见下方示例 | [状态规则](SDK-AUTHORING.md#状态取消与演进) |
| 让用户调整设置 | `manifest.configuration` 声明字段，`ctx.configuration` 读取；用户在扩展管理中修改 | [配置契约](EXTENSION-CONFIGURATION.md) |
| 连接真实模型 | 声明 `credentialBindings` 和 `capabilities: ["credential.request"]`，用 `ctx.platform("credential.request", { version: 1, binding, body })` 发请求；API Key 由用户在扩展详情中录入，扩展拿不到密钥 | [DeepSeek 连接器](../extensions/connectors/deepseek.js)、[请求契约](CREDENTIAL-REQUEST.md) |
| 让扩展管理显示谁在用 | `ctx.shell.publishUsers("Agent", [{ id, label, uses }], toggle)`；停用时自动清除 | [页面契约](PAGES.md#让扩展使用宿主入口) |
| 使用别的扩展提供的服务 | `requires: { "服务名": 版本 }`，`ctx.use("服务名")` 取一个，`ctx.providers("服务名")` 列出全部；没有提供者也要能启用时改用 `optional: { "服务名": 版本 }`，只能用 `ctx.providers` | [事件样板](../extensions/examples/events.js) |

**界面**：`id` 在所有扩展中唯一，用你的扩展 ID 即可。默认（`presentation: "workspace"`）在 应用菜单 → 应用设置 →「界面布局」中选「使用 + label」后占据整个工作区，取代 Agent 界面；`"dialog"` 出现在应用菜单中，`"sidebar"` 出现在右侧栏。`root` 是一个空容器，应用的字体、颜色和按钮样式会作用于其中的普通元素。

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

**数据**：每个扩展有一份自己的数据，最大 64 KiB（按保存后的 JSON 计）。`value` 可以是任意 JSON。写入时传入读取时得到的 `revision`（还没有数据时为 `0`），成功后返回新的 `{ revision, value }`；如果期间数据被改过，写入会被拒绝，原数据不变，重新读取后再写即可。

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
- **看日志**：Mac debug 版在窗口内右键 → 检查元素；Android debug 版用电脑 Chrome 打开 `chrome://inspect`。

## 5. 目前的限制

- 只能是一个文件，存储后不超过 60 KiB。文件里不能 `import` 其他文件或 npm 包，需要的代码请写在同一文件中。
- 文本服务每次只收到当前这条消息，拿不到会话历史和角色说明。
- 编辑器类型提示需要仓库里的 [SDK 类型](../modules/sdk/index.ts) 和 [服务接口](../extensions/contracts.d.ts)；单独使用模板时可删掉 `@type` 注释。
- 扩展与应用在同一环境中运行，没有沙箱。只导入你信任的文件，也只把你的文件交给信任你的人。
- 替换一个连接模型的扩展后，来源会变化，需要在扩展详情中重新录入 API Key。
- 浏览器预览中不能调用真实模型，要在 Mac 或 Android 应用中试。

更完整的接口与规则见 [SDK 参考](SDK-AUTHORING.md) 和 [扩展契约](EXTENSION-CONTRACTS.md)，类型定义在 [modules/sdk/index.ts](../modules/sdk/index.ts)。
