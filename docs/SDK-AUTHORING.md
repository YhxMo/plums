# 实验 SDK 进阶参考

第一次写扩展请先读[作者入门](AUTHOR-QUICKSTART.md)。本文补充入门之外的规则与开发样板；各项能力的完整契约与失败语义由[扩展契约](EXTENSION-CONTRACTS.md)统一索引。

[SDK 类型](../modules/sdk/index.ts) · [契约与失败语义](EXTENSION-CONTRACTS.md) · [整体计划](spec/total.md)

状态：当前有效（2026-10-24 核实）；实验 SDK 参考，不承诺稳定兼容与发布包。

这是仓库内实验接口，不是已发布 npm 包或稳定 SDK。运行时只需要标准 ESM 与 Web API，不需要 Node.js；Node 仅用于开发工具。`apiVersion: 1` 精确匹配，服务版本也是正整数精确匹配，没有 semver 范围协商。扩展自身 `version` 是显示/追溯字符串，不会自动迁移状态。

## 创建与运行

扩展是一个文件夹：`manifest.json` 是清单，`main.js` 默认导出 `{ activate(ctx) }`（类型 `ExtensionMain`），宿主把两者组合为 `ExtensionDefinition`；`main.js` 若也导出 `manifest`，其 ID 须与清单一致。导入、开发服务路径与开发目录都用这一形式，只有随应用打包的内置模块在 TypeScript 中直接声明 manifest。ID 为小写字母开头、最长 64 字符，仅含小写字母、数字、点和连字符且不含连续点。可选 `name`（1–40 字符）作为导入后的显示名称，`author`（1–80 字符）在导入确认中显示为作者，`license`（1–80 字符，如 `MIT`）在别人把它随 Agent 一起导出前显示，`description`（1–500 字符）在导入确认与扩展详情中按纯文本显示，不解析 HTML 或 Markdown；不合格的值拒绝导入。先为提供/消费服务填写 `provides`/`requires`，所有资源绑定 ctx 生命周期。同一服务可由多个扩展同时提供，同一扩展重复提供才拒绝；`ctx.use(name)` 取最早启用的提供者并与它绑定，它停用时本扩展随之重启并改用下一个；`ctx.providers(name, onChange?)` 返回全部已启用提供者 `{id, label, value, signal}`（`signal` 在该提供者停用时中止，可用来取消对它的在途调用），列表变化时回调，最后一个提供者停用前本扩展不重启；全部提供者在同一次失效中一起停用时，本扩展随即关闭。`optional` 与 `requires` 格式相同，声明没有提供者也能运行的服务：启用不等待它，最后一个提供者停用也不关闭本扩展；只能经 `ctx.providers` 使用（及在 `publishUsers` 开关中引用），同一服务不能同时写在两处。清理失败会锁存为 `cleanup-failed`，不能当作卸载成功。不要顶层启动业务：模块 import 在确认启用前就会执行，可信模式不是代码沙箱。

以下三个样板文件夹仅随源码提供，可在 `npm run dev` 中按路径加载；打包应用须导入扩展包（见[作者入门](AUTHOR-QUICKSTART.md)）。样板不读取真实账户或状态；版本变化后，已保存的组合需核对精确版本：

| 样板 | 路径 / ID / 版本 | 行为 |
| --- | --- | --- |
| [服务](../extensions/examples/counter/) | `/examples/counter/` / `sample.counter` / 1.1.0 | 提供 `sample.counter@1`，含 read() 与 increment()；激活时计数从零开始 |
| [无 UI 事件扩展](../extensions/examples/events/) | `/examples/events/` / `sample.events` / 1.0.0 | 消费计数服务；收到 `sample.increment` 增加计数并发布 `sample.changed` |
| [非聊天视图](../extensions/examples/panel/) | `/examples/panel/` / `sample.panel` / 1.1.0 | 消费计数服务；按钮发布事件并同步刷新，释放时删除自己创建的 DOM/监听 |

以下是在仓库中开发的方式；不装 Node.js 也可以把扩展包导入应用，见[作者入门](AUTHOR-QUICKSTART.md)。执行 `npm ci`、`npm run dev` 后打开本地预览。窄栏的“扩展”→ 安装扩展，展开“开发者：按路径安装”，依次填写上述路径（ID 从清单读取），安装并分别启用。服务先启用后事件/视图可工作；反向顺序会等待依赖。应用设置选择“计数样板”，从扩展管理点“返回工作区”，再点击“增加计数”。停用事件扩展后按钮不会递增，再启用事件扩展后可继续；停用服务会让依赖者等待，重新启用服务会创建新计数器。它是内存样板，不承诺保存计数或长期后台运行。

在已有服务消费者中替换提供者：先停用原提供者，再加载一个提供相同服务名及版本的新 ID 并启用。消费者重新激活，必须重新获取服务；不要把服务对象缓存到生命周期之外。缺失必需服务显示 `waiting` 与原因；多个扩展可提供同一服务，同一扩展重复提供才拒绝，已有提供者不被隐式覆盖。

## 宿主管理入口

管理集成使用 [Host](../modules/extension-host/host.ts) 与 [loadExtension](../modules/extension-host/definition.ts) 的公开方法；扩展自身只获得 SDK 的 `ExtensionContext`，没有管理权限。应用外壳的安装路径持久化仍归外壳所有。

| 操作 | 当前保证与失败行为 |
| --- | --- |
| loadExtension(folderUrl, expectedId?) | 先读取并校验 `manifest.json`，再加载 `main.js` 并组合；校验 ID 与 API；同源限制由应用安装入口执行，此函数不是网络安全策略。导入的扩展包走 `loadPackage`（Blob URL），见[架构](ARCHITECTURE.md) |
| install(definition) | 校验后只登记 disabled，不激活；重复 ID 拒绝，不能用它覆盖升级 |
| grant(id, capabilities) / start(id) | 仅授予已声明能力；启动等待缺失依赖/授权/平台能力，激活失败有诊断 |
| stop(id) | 取消任务并释放服务、监听、视图；依赖者等待；失败保留诊断且要求重启 |
| uninstall(id) | 必须先成功 stop（新安装且未启动也可）；串行撤销平台授权后才移除宿主记录。撤权失败保留记录，可重试；不删除模块文件、安装路径配置或用户数据 |
| 同 ID 重新安装 | 必须先卸载；重新授权才可访问同一状态作用域；不是热升级或自动迁移 |
| inspect / ids / manifest / serviceNames / views / themes | 用于管理诊断；停用清理成功应无正常注册或任务 |

最小管理装配签名如下（Platform 定义见 SDK）：

```ts
const host = new Host(platform, cleanupTimeout /* 可选，默认 800ms */);
host.install(definition); // void
await host.grant(id, capabilities); // Promise<void>
await host.start(id); // Promise<void>
await host.stop(id); // Promise<void>
await host.uninstall(id); // Promise<void>
host.ids(); // string[]
host.serviceNames(); // string[]
host.manifest(id); // Manifest
host.inspect(id); // {status, error?: string, desired: boolean, resources: number, tasks: number}
// status: disabled | waiting | active | stopping | failed | cleanup-failed
host.views(); // {id, label, owner, generation, presentation, entry?, priority, chrome?, icon?, iconProblem?}[]
host.themes(); // (Theme & {owner, generation})[]，仅开放的 active 贡献
const close = host.mountView(viewId, root); // () => void | Promise<void>
```

管理查询未知 ID 会抛错；公开服务通过另一个声明 requires 的扩展 ctx.use 获取，管理者不直接读取内部服务表。管理操作 start/stop/grant/uninstall 串行执行；install 是同步登记。Platform 为注入适配器，测试可以实现 SDK 中的接口，不能把模拟结果当原生证据。

外壳的“卸载（保留数据）”顺序与失败处理见[扩展契约](EXTENSION-CONTRACTS.md#生命周期与失败行为)。升级需保留旧模块与数据、核对兼容，再停用/卸载/重装；业务迁移可使用[可选状态助手](STATE-MIGRATION.md)，包升级事务和自动数据删除待实现。ESM 由环境缓存，同 URL 重新 import 不保证新代码；新版本使用新 URL 并记录来源。

## 页面与公开宿主入口

扩展可通过 `ctx.shell.open("extensions" | "settings" | "diagnostics")` 请求呈现宿主入口，`open("extensions", id)` 选中指定扩展，`open("view", viewId)` 打开某个 dialog 视图；这不授予权限或直接管理其他扩展。`ctx.shell.dependencies()` 列出本扩展及经 `ctx.use` 绑定的提供者，`ctx.shell.publishUsers(kind, users, toggle?)` 让扩展管理显示谁在使用哪个扩展，并可提供按使用者开关某个提供者的操作，规则见页面契约。实验接口 `ctx.shell.bundle(ids)` 返回其中已安装的扩展（ID、版本、名称、作者、许可证；导入的扩展另带 `manifest.json` 与 `main.js` 原文），供整包导出；`ctx.shell.offerPackages(packages)` 把整包里的扩展交给扩展管理逐个确认安装，按顺序返回每个的结果（`installed`／`replaced`／`kept`／`declined`／`refused`），确认前不执行其中的代码，安装后保持停用。`View.presentation` 可选声明 workspace/dialog/sidebar，外壳按声明装配主视图、菜单和上下文侧栏，旧视图默认 workspace。动态页面、导航保存、嵌套贡献、焦点与清理，以及向开发文本工作台登记页面，见 [页面契约](PAGES.md)。

## 工作区标题与上下文侧栏

工作区希望显示当前处理项标题时（手机在顶栏，桌面在内容区顶部一行），在 `ctx.view` 中提供可选 `chrome`。下面的普通 ESM 示例通过稳定快照和订阅发布标题，不需要 React 或宿主私有事件：

```js
export default {
  manifest: { id: "sample.titles", version: "1.0.0", apiVersion: 1 },
  activate(ctx) {
    let state = { title: "待处理项目" };
    const listeners = new Set();
    const chrome = {
      getSnapshot() {
        return state;
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    ctx.view({
      id: "sample.titles",
      label: "项目工作区",
      chrome,
      mount(root) {
        const button = document.createElement("button");
        button.textContent = "打开项目";
        button.onclick = () => {
          state = { title: "当前项目" };
          listeners.forEach((listener) => listener());
        };
        root.append(button);
        return () => root.replaceChildren();
      },
    });
  },
};
```

`getSnapshot()` 在状态未变时返回同一对象；变化时先替换快照，再通知订阅者。外壳只订阅当前工作区，切换或停用时取消订阅。读取或订阅失败会让外壳排除该代视图并回退，管理入口仍可达。

开发服务中可按路径安装 `example.workspace-chrome`（`/examples/workspace-chrome/`）和 `example.workspace-context`（`/examples/workspace-context/`）查看标题更新、实体/工作区侧栏优先级、草稿跨管理保留及回调失败回退。打包应用不含这些路径，可下载源码后把文件夹作为扩展包导入；“模拟标题回调失败”会隔离该代工作区，停用后重新启用可恢复。样板只消费公开 ctx.view/ctx.shell，不提供持久业务或平台权限。

完整类型见 [workspace-chrome.ts](../modules/sdk/workspace-chrome.ts)。工作区在快照中提供可选 `sidebar`（它自己的详情：label、真实 open 状态、toggle(source) 和 close()）时，右侧栏按钮只开关这份详情，扩展的 sidebar 贡献不接管按钮；详情以侧栏还是弹窗呈现由工作区决定。不要在外壳另存默认详情开关。没有 `sidebar` 的工作区由 `contextOwner`（当前实体所属扩展）选侧栏：外壳优先查找该扩展的 sidebar 贡献，然后查找当前工作区扩展自己的 sidebar，同一所有者内按 priority 降序和 ID 升序选择。默认 Agent 界面发布了详情，因此 Agent 的上下文侧栏目前不显示；计划在 Agent 详情的「组成扩展」里为有 sidebar 贡献的扩展行加入口，在详情内以子页呈现它，随第一个真实面板（如记忆）实现。

工作区自己画卡片时，在快照中提供 `frame: "own"`：外壳不再给内容区画卡片，并把右侧栏按钮放在距窗口 `--pane-gap`、高 `--pane-header` 的方块中居中，视图的卡片按这两个 CSS 变量留边并设定右上方头部高度。外壳不读取视图的 DOM 来判断这一点；不提供时外壳照常画一张卡片。

工作区存在上一层时，在快照中提供 `back()`；回到根层后发布不含 `back` 的新快照。Android 系统 Back 先处理 IME、顶层弹窗和宿主管理，再调用当前工作区的该方法；方法保留快照对象的接收者。工作区负责保存草稿并在返回后恢复有效焦点，操作抛错时外壳隔离该代视图并保留恢复入口。未提供 `back()` 的既有视图保持原挂载契约，宿主不猜测其业务路由。

可选 `navigation` 包含实体类型 `entityType` 和 `reveal(id)`。调用方先匹配类型，再导航；宿主目前不消费此字段；扩展若使用它，须先核对 `entityType` 再调用，不能把 Agent ID 传给其他业务。仓库内 TypeScript 视图可用 `createWorkspaceChrome(entityType)`、`publish(state)` 和 `connect(handler)` 组装同一接口；挂载时连接处理器，释放时执行 connect 返回的清理函数，旧挂载的迟到清理不会断开替代处理器。未提供 chrome 的已有视图继续按原挂载契约工作。

工作区需要区分“仍挂载”和“正在展示”时，可使用可选 `chrome.visibility`：外壳通过 `set(boolean)` 发布是否显示工作区，扩展通过 `getSnapshot()` 与 `subscribe(listener)` 消费。扩展管理隐藏工作区、切换布局或卸载时为 false，返回时为 true；它不代表操作系统窗口焦点。`createWorkspaceChrome` 自带该接口，独立挂载默认 true；发布标题不会覆盖可见状态，订阅返回的清理函数须在释放时调用。没有该接口的已有视图不受影响。

工作区要接收拖进窗口的文件时，在发布的状态中提供可选 `drop`：`label` 是文件拖过窗口时外壳显示的提示，`add(files)` 接收松开的文件；省略 `add` 表示此刻拒绝并由 `label` 说明原因，省略整个 `drop` 则静默拒绝。外壳只在工作区正在显示、拖放位置在外壳之内（不在弹窗或菜单中）且没有更内层的拖放区先处理（在 `dragover`／`drop` 中调用 `preventDefault`）时转交；工作区可给某个元素加 `data-drop-area` 属性，拖动经过其中时提示只覆盖这个元素，否则覆盖整个窗口；`add` 抛出的错误按视图回调失败处理。

工作区要响应应用菜单的 ⌘N 与 ⌘F 时，在发布的状态中提供可选 `commands`：`new()` 开始创建此工作区的实体，`find()` 把焦点移到它的搜索；省略的命令什么也不做。外壳只询问当前显示的工作区，扩展管理或模态窗口显示时不调用；回调抛错与其他快照回调一样隔离该代视图。设置（⌘,）属于外壳，工作区不参与。

## 状态、取消与演进

能力通过 manifest 声明并经授权后用 ctx.platform 调用。`state.read` 返回 null 或 `{revision, value}`；`state.write` 使用 `{revision, value}` 并返回提交回执。作用域为 `extension.<id>`，同 ID 重装保留原数据；未知 schema/修订冲突/超过 1 MiB（按保存后含外层的 JSON 计）拒绝，不自动清空。两者都可带 `key`（`[a-z0-9][a-z0-9-]{0,63}`）读写同一作用域下的独立分片，每个分片有自己的修订号与 1 MiB 上限；`state.write` 传 `{key, revision, remove: true}` 在修订号匹配时删除该分片（不存在且修订号为 0 时为空操作）。宿主不提供分片枚举，扩展自行在主文档中记录分片名。不要在样板中存储凭据。业务状态结构和迁移由扩展明确设计，宿主不解析其业务对象。

条目多、要一起保存或需要搜索的数据（如聊天记录）用批量写与记录，类型见 [records.ts](../modules/sdk/records.ts)。`state.batch`、`records.list`、`records.search` 是三项独立能力，分别声明并经用户授权，读写范围同样限于自己的作用域。

- **批量写**：原生 `state.batch` 在一个事务里依次写入 `documents`（每项同 `state.write` 的载荷）、清空 `clear` 列出的集合、写入 `records`；任一修订号不符或任一项无效时整批拒绝，什么都不写。同一文档、集合或记录在一批中只能出现一次；一批最多 1000 项，值与文本合计不超过 16 MiB。回执按请求顺序列出 `documents` 的 `{revision}` 与 `records` 的 `{seq, revision}`，删除项为 null；取消与未知回执的规则同 `state.write`。浏览器预览使用 localStorage，中途失败时逆序恢复已写入的键；全部恢复才报告 `not-committed`，回滚失败则报告 `unknown`，调用方须重新读取后再修改。
- **记录**：集合（`collection`）中按 `id` 区分的 JSON 值，两者与 `parent` 均为 `[A-Za-z0-9][A-Za-z0-9:._-]{0,127}`；修订号与删除（`remove: true`）的规则同文档，`value` 与 `text` 合计不超过 8 MiB（容得下一条带图片的聊天消息）。`seq` 是记录首次写入时在作用域内的次序，修改不变，删除后再写入排到最后。`parent` 原样保存，宿主不检查它指向的记录，供分支等结构使用。
- **列出**：`records.list` 传 `{collection, after?, limit?, order?}`，按 `seq` 返回一页 `{records, next}`；`limit` 1–200（默认 50），`order` 为 `"asc"`（默认）或 `"desc"`，把 `next` 作为下一页的 `after`，最后一页为 null。一页的值与文本合计超过 16 MiB 前提前结束（至少含一条），所以条数可能少于 `limit`。
- **搜索**：`records.search` 传 `{query, collection?, after?, limit?}`，返回 `text` 中包含 `query` 的记录，新的在前，分页同 `records.list`；`query` 去掉首尾空白后 1–256 个字符，词中间也能匹配，英文字母不区分大小写；`limit` 1–100（默认 20）。`text` 由扩展写入，宿主不从 `value` 提取，没有 `text` 的记录不会被找到。

请求无效时错误带 `code`：`invalid-batch`、`invalid-collection`、`invalid-record`、`invalid-query`，以及与文档相同的 `invalid-key`、`missing-revision`、`missing-value`、`revision-conflict`、`state-too-large`。

ctx.task 跟踪异步任务，使用传入 signal 合作式取消；ctx.onDispose 管理其他资源。挂载函数返回自己的清理函数，视图关闭也会调用它。平台调用可以传操作信号；原生派发写入后不可取消，成功回执表示提交，未知回执先重新读取再决定恢复，不盲目重试。

实验期间破坏性 SDK 变更必须变更 apiVersion、记录迁移说明并测试旧版拒绝路径；服务破坏性变更提高服务版本，保留或明确移除旧提供者，不静默改变原版本语义。此处是演进规则，不承诺兼容窗口、自动迁移或无限资源。正式稳定、分发与平台支持按阶段证据另行声明。

## 验证边界

开发时执行 `npm test` 与 `npm run build`；安装、启停、视图和管理路径使用隔离浏览器上下文验证。浏览器不代表原生撤权、打包资源或真实设备行为，涉及平台能力时须验证实际包。当前交付范围见[交付入口](../evidence/RESULTS.md)。

## 其他能力

组合保存、非敏感配置、凭据请求与自建连接、状态迁移、视图树、事件服务和会话内文档访问的契约见[扩展契约](EXTENSION-CONTRACTS.md#平台能力与可选助手)及其链接的专题文档。

## 公开主题样板

[主题颜色契约](THEMES.md)提供 `ctx.theme(Theme)`、17个语义色、可选布局色与生命周期规则。两个独立作者样板 [海湾](../extensions/samples/theme-ocean/)（`sample.theme-ocean` / `/samples/theme-ocean/`）和 [墨夜](../extensions/samples/theme-ink/)（`sample.theme-ink` / `/samples/theme-ink/`）仅在开发服务中提供，不自动启用。按上述安装流程分别安装、启用，应用设置选择“使用 海湾”或“使用 墨夜”。无需平台权限。选择成功后可关闭设置；停用主题恢复内置外观，重新启用恢复已选主题。启用集合会自动保留到重启后。打包应用不包含这些样板路径，可把样板文件夹作为扩展包导入。

主题注册的颜色被复制；`Host.themes()` 返回带owner/generation的副本用于管理，重新贡献前应取出主题本身的四个字段。完整主题系统、导航和快捷键仍未稳定。
