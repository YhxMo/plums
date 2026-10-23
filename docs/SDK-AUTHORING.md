# 实验 SDK 作者入口

第一次写扩展请先读[作者入门](AUTHOR-QUICKSTART.md)；本文是详细参考。

[SDK 类型](../modules/sdk/index.ts) · [契约与失败语义](EXTENSION-CONTRACTS.md) · [整体计划](spec/total.md)

状态：当前有效（2026-10-18 核实）；实验 SDK 入口，不承诺稳定兼容与发布包。

这是仓库内实验接口，不是已发布 npm 包或稳定 SDK。运行时只需要标准 ESM 与 Web API，不需要 Node.js；Node 仅用于开发工具。`apiVersion: 1` 精确匹配，服务版本也是正整数精确匹配，没有 semver 范围协商。扩展自身 `version` 是显示/追溯字符串，不会自动迁移状态。平台支持按实际包分别声明；iOS 实验属于跨平台声明前置。

## 创建与运行

扩展默认导出 `ExtensionDefinition`，包含 manifest 与 activate(ctx)。ID 为小写字母开头、最长 64 字符，仅含小写字母、数字、点和连字符且不含连续点。可选 `name`（1–40 字符）作为导入后的显示名称，`description`（1–500 字符）在导入确认与扩展详情中按纯文本显示，不解析 HTML 或 Markdown；不合格的值拒绝导入。先为提供/消费服务填写 `provides`/`requires`，所有资源绑定 ctx 生命周期。同一服务可由多个扩展同时提供，同一扩展重复提供才拒绝；`ctx.use(name)` 取最早启用的提供者并与它绑定，它停用时本扩展随之重启并改用下一个；`ctx.providers(name, onChange?)` 返回全部已启用提供者 `{id, label, value, signal}`（`signal` 在该提供者停用时中止，可用来取消对它的在途调用），列表变化时回调，最后一个提供者停用前本扩展不重启；全部提供者在同一次失效中一起停用时，本扩展随即关闭。`optional` 与 `requires` 格式相同，声明没有提供者也能运行的服务：启用不等待它，最后一个提供者停用也不关闭本扩展；只能经 `ctx.providers` 使用（及在 `publishUsers` 开关中引用），同一服务不能同时写在两处。清理失败会锁存为 `cleanup-failed`，不能当作卸载成功。不要顶层启动业务：模块 import 在确认启用前就会执行，可信模式不是代码沙箱。

以下三个 ESM 样板仅随源码提供，可在 `npm run dev` 中按模块路径加载；打包应用须从本地导入单文件。样板不读取真实账户或状态：

| 样板 | 模块路径 / ID | 行为 |
| --- | --- | --- |
| [服务](../extensions/examples/counter.js) | `/examples/counter.js` / `sample.counter` | 提供 `sample.counter@1`，含 read() 与 increment()；激活时计数从零开始 |
| [无 UI 事件扩展](../extensions/examples/events.js) | `/examples/events.js` / `sample.events` | 消费计数服务；收到 `sample.increment` 增加计数并发布 `sample.changed` |
| [非聊天视图](../extensions/examples/panel.js) | `/examples/panel.js` / `sample.panel` | 消费计数服务；按钮发布事件并同步刷新，释放时删除自己创建的 DOM/监听 |

以下是在仓库中开发的方式；不装 Node.js 也可以把单个文件导入应用，见[作者入门](AUTHOR-QUICKSTART.md)。执行 `npm ci`、`npm run dev` 后打开本地预览。窄栏的“扩展”→ 安装扩展，依次填写上述 ID 与模块路径，安装并分别启用。服务先启用后事件/视图可工作；反向顺序会等待依赖。应用设置选择“计数样板”，从扩展管理点“返回工作区”，再点击“增加计数”。停用事件扩展后按钮不会递增，再启用事件扩展后可继续；停用服务会让依赖者等待，重新启用服务会创建新计数器。它是内存样板，不承诺保存计数或长期后台运行。

在已有服务消费者中替换提供者：先停用原提供者，再加载一个提供相同服务名及版本的新 ID 并启用。消费者重新激活，必须重新获取服务；不要把服务对象缓存到生命周期之外。缺失必需服务显示 `waiting` 与原因；多个扩展可提供同一服务，同一扩展重复提供才拒绝，已有提供者不被隐式覆盖。

## 宿主管理入口

管理集成使用 [Host](../modules/extension-host/host.ts) 与 [loadExtension](../modules/extension-host/definition.ts) 的公开方法；扩展自身只获得 SDK 的 `ExtensionContext`，没有管理权限。应用外壳的安装路径持久化仍归外壳所有。

| 操作 | 当前保证与失败行为 |
| --- | --- |
| loadExtension(url, expectedId) | 加载默认导出、校验 ID 与 API；同源限制由应用安装入口执行，此函数不是网络安全策略。从文件导入走 `loadExtensionSource`（Blob URL），见[架构](ARCHITECTURE.md) |
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
host.views(); // {id, label, owner, generation, presentation, priority, chrome?, icon?, iconProblem?}[]
host.themes(); // (Theme & {owner, generation})[]，仅开放的 active 贡献
const close = host.mountView(viewId, root); // () => void | Promise<void>
```

管理查询未知 ID 会抛错；公开服务通过另一个声明 requires 的扩展 ctx.use 获取，管理者不直接读取内部服务表。管理操作 start/stop/grant/uninstall 串行执行；install 是同步登记。Platform 为注入适配器，测试可以实现 SDK 中的接口，不能把模拟结果当原生证据。

应用外壳仅为手动安装的扩展提供“卸载（保留数据）”：先停用、撤权，再保存安装路径移除结果，最后移除宿主记录。内置扩展只能停用；模块文件与扩展数据不删除。配置保存或撤权失败显示未完成，可重试；回执未知时须重载确认。升级需保留旧模块与数据、核对兼容，再停用/卸载/重装；业务迁移可使用[可选状态助手](STATE-MIGRATION.md)，包升级事务和自动数据删除待实现。ESM 由环境缓存，同 URL 重新 import 不保证新代码；新版本使用新 URL 并记录来源。

## 页面与公开宿主入口

扩展可通过 `ctx.shell.open("extensions" | "settings" | "diagnostics")` 请求呈现宿主入口，`open("extensions", id)` 选中指定扩展，`open("view", viewId)` 打开某个 dialog 视图；这不授予权限或直接管理其他扩展。`ctx.shell.dependencies()` 列出本扩展及经 `ctx.use` 绑定的提供者，`ctx.shell.publishUsers(kind, users, toggle?)` 让扩展管理显示谁在使用哪个扩展，并可提供按使用者开关某个提供者的操作，规则见页面契约。`View.presentation` 可选声明 workspace/dialog/sidebar，外壳按声明装配主视图、菜单和上下文侧栏，旧视图默认 workspace。动态页面、导航保存、嵌套贡献、焦点与清理见 [页面契约和文本处理工作台](PAGES.md)。

开发构建中，从扩展管理启用 `ui.workbench-board` 并确认状态权限，可体验非聊天界面。作者可通过公开服务 `text-workbench.pages@1` 登记自己的页面，无需改内核；接口与样板见[页面契约](PAGES.md)。

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

开发服务中可按模块路径安装 `example.workspace-chrome`（`/examples/workspace-chrome.js`）和 `example.workspace-context`（`/examples/workspace-context.js`）查看标题更新、实体/工作区侧栏优先级、草稿跨管理保留及回调失败回退。打包应用不含这些路径，可下载源码后通过本地文件导入；“模拟标题回调失败”会隔离该代工作区，停用后重新启用可恢复。样板只消费公开 ctx.view/ctx.shell，不提供持久业务或平台权限。

完整类型见 [workspace-chrome.ts](../modules/sdk/workspace-chrome.ts)。`contextOwner` 指向当前实体所属扩展；外壳优先查找该扩展的 sidebar 贡献，然后查找当前工作区扩展自己的 sidebar，同一所有者内按 priority 降序和 ID 升序选择。无匹配贡献时使用可选 `sidebar` 中的 label、真实 open 状态、toggle(source) 和 close()。默认 inline 详情与扩展侧栏互斥；移动模态详情声明 `presentation: "dialog"`，转为 inline 后重新协调。不要在外壳另存默认详情开关。

工作区存在上一层时，在快照中提供 `back()`；回到根层后发布不含 `back` 的新快照。Android 系统 Back 先处理 IME、顶层弹窗和宿主管理，再调用当前工作区的该方法；方法保留快照对象的接收者。工作区负责保存草稿并在返回后恢复有效焦点，操作抛错时外壳隔离该代视图并保留恢复入口。未提供 `back()` 的既有视图保持原挂载契约，宿主不猜测其业务路由。

可选 `navigation` 包含实体类型 `entityType` 和 `reveal(id)`。调用方先匹配类型，再导航；宿主目前不消费此字段；扩展若使用它，须先核对 `entityType` 再调用，不能把 Agent ID 传给其他业务。仓库内 TypeScript 视图可用 `createWorkspaceChrome(entityType)`、`publish(state)` 和 `connect(handler)` 组装同一接口；挂载时连接处理器，释放时执行 connect 返回的清理函数，旧挂载的迟到清理不会断开替代处理器。未提供 chrome 的已有视图继续按原挂载契约工作。

## 状态、取消与演进

能力通过 manifest 声明并经授权后用 ctx.platform 调用。`state.read` 返回 null 或 `{revision, value}`；`state.write` 使用 `{revision, value}` 并返回提交回执。作用域为 `extension.<id>`，同 ID 重装保留原数据；未知 schema/修订冲突/超过 64 KiB 拒绝，不自动清空。两者都可带 `key`（`[a-z0-9][a-z0-9-]{0,63}`）读写同一作用域下的独立分片，每个分片有自己的修订号与 64 KiB 上限；`state.write` 传 `{key, revision, remove: true}` 在修订号匹配时删除该分片（不存在且修订号为 0 时为空操作）。宿主不提供分片枚举，扩展自行在主文档中记录分片名。不要在样板中存储凭据。业务状态结构和迁移由扩展明确设计，宿主不解析其业务对象。

ctx.task 跟踪异步任务，使用传入 signal 合作式取消；ctx.onDispose 管理其他资源。挂载函数返回自己的清理函数，视图关闭也会调用它。平台调用可以传操作信号；原生派发写入后不可取消，成功回执表示提交，未知回执先重新读取再决定恢复，不盲目重试。

实验期间破坏性 SDK 变更必须变更 apiVersion、记录迁移说明并测试旧版拒绝路径；服务破坏性变更提高服务版本，保留或明确移除旧提供者，不静默改变原版本语义。此处是演进规则，不承诺兼容窗口、自动迁移或无限资源。正式稳定、分发与平台支持按阶段证据另行声明。

## 验证边界

开发时执行 `npm test` 与 `npm run build`；安装、启停、视图和管理路径使用隔离浏览器上下文验证。浏览器不代表原生撤权、打包资源或真实设备行为，涉及平台能力时须验证实际包。当前交付范围见[交付入口](../evidence/RESULTS.md)。

## 组合保存与恢复

外壳自动记录启用集合与按版本的授权，下次启动恢复；版本变化后权限须重新确认。提供者选择由集合确定，缺失的扩展跳过。配置所有权、部分恢复边界与卸载同步见 [组合契约](COMPOSITION.md)。

## 非敏感配置

通过 manifest.configuration 声明带默认值的 string/number/boolean 字段，activate 读取只读 ctx.configuration；外壳提供配置编辑、验证和持久化。示例与保存/重启/失败边界见 [配置契约](EXTENSION-CONFIGURATION.md)。普通配置禁止存放密钥或令牌，不提供凭据授权。counter/panel 当前为 1.1.0，旧组合需核对精确版本。

## 凭据代用请求

[凭据代用请求契约](CREDENTIAL-REQUEST.md)在 Mac 与 Android 应用中可用，浏览器预览不可用。绑定确定内容类型、固定头和认证注入，扩展只提交别名与序列化载荷，秘密留在原生侧；不在普通配置中保存秘密。

内置[模型连接器](MODELS.md)是当前的实际服务实现：`connector.models` 用 `credential.connect` 让用户自建连接，提供 `chat@1`；协议载荷、回复解析和错误脱敏留在扩展，不直接调用 fetch 或读取密钥。浏览器预览中保持等待。

可选 `manifest.credentialBindings` 声明非秘密连接建议，沿用现有扩展安装与管理入口；声明不创建绑定或授予请求权限。[通用绑定与原生录入](CREDENTIAL-BINDINGS.md)说明每绑定媒体类型、固定头、秘密注入、显式代理配置及取消/未知/卸载清理状态。既有扩展可继续不声明该字段。需要让用户自建多条连接（例如多个模型服务）的扩展改为声明 `credentialProtocols` 协议模板并申请 `credential.connect`，见[扩展自建连接](CREDENTIAL-BINDINGS.md#扩展自建连接)。

[可选单跳状态迁移助手](STATE-MIGRATION.md)已提供公开 SDK 入口与独立样板：扩展定义业务转换，助手用一次修订号提交保留旧快照；当前不自动迁移默认业务，也不提供通用包升级事务或自动回退。

可选[固定视图树助手](VIEW-TREE.md)由开发文本工作台通过页面路由使用，页面可嵌套另一扩展的节点；固定树挂载后不能追加子节点，也不承担 Host 异步失败回退。

无业务视图事件服务的启停、撤权与恢复限定结果见 [执行边界](EVENT-SERVICE.md)；暂停映射为 stop，新一代重新订阅，不提供后台常驻或持久事件队列。

可选 [显式旧快照恢复](STATE-MIGRATION.md#按确认修订号显式恢复旧快照)要求已确认的 revision/from/to 与业务校验，一次恢复保留被替换目标；不自动回滚包或用户状态。

[会话内文档只读访问](SELECTED-DOCUMENT.md)提供实验类型、宿主选择/撤销及扩展 document.read；仅支持探测成功的 Mac/Android，浏览器不可用。样板 `/samples/documents.js`（仅开发构建目录）从扩展管理选择文档后，经公开契约列举/读取；停用即失效，不保存文件授权。实际支持范围以专项证据为准。

## 公开主题样板

[主题颜色契约](THEMES.md)提供 `ctx.theme(Theme)`、17个语义色、可选布局色与生命周期规则。两个独立作者样板 [海湾](../extensions/samples/theme-ocean.js)（`sample.theme-ocean` / `/samples/theme-ocean.js`）和 [墨夜](../extensions/samples/theme-ink.js)（`sample.theme-ink` / `/samples/theme-ink.js`）仅在开发服务中提供，不自动启用。按上述安装流程分别安装、启用，应用设置选择“使用 海湾”或“使用 墨夜”。无需平台权限。选择成功后可关闭设置；停用主题恢复内置外观，重新启用恢复已选主题。启用集合会自动保留到重启后。打包应用不包含这些样板路径，需导入本地单文件。

主题注册的颜色被复制；`Host.themes()` 返回带owner/generation的副本用于管理，重新贡献前应取出主题本身的四个字段。完整主题系统、导航和快捷键仍未稳定。
