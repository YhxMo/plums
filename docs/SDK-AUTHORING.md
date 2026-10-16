# 实验 SDK 作者入口

[SDK 类型](../modules/sdk/index.ts) · [契约与失败语义](EXTENSION-CONTRACTS.md) · [整体计划](spec/total.md)

这是仓库内实验接口，不是已发布 npm 包或稳定 SDK。运行时只需要标准 ESM 与 Web API，不需要 Node.js；Node 仅用于开发工具。`apiVersion: 1` 精确匹配，服务版本也是正整数精确匹配，没有 semver 范围协商。扩展自身 `version` 是显示/追溯字符串，不会自动迁移状态。正式稳定前必须完成 iOS 最小原生实验。

## 创建与运行

扩展默认导出 `ExtensionDefinition`，包含 manifest 与 activate(ctx)。ID 为小写字母开头、最长 64 字符，仅含小写字母、数字、点和连字符且不含连续点。先为提供/消费服务填写 `provides`/`requires`，所有资源绑定 ctx 生命周期；清理失败会锁存为 `cleanup-failed`，不能当作卸载成功。不要顶层启动业务：模块 import 在确认启用前就会执行，可信模式不是代码沙箱。

可直接复制以下三个随包 ESM 样板；它们不加入默认目录、不自动启用、不读取真实账户或状态：

| 样板 | 模块路径 / ID | 行为 |
| --- | --- | --- |
| [服务](../extensions/examples/counter.js) | `/examples/counter.js` / `sample.counter` | 提供 `sample.counter@1`，含 read() 与 increment()；激活时计数从零开始 |
| [无 UI 事件扩展](../extensions/examples/events.js) | `/examples/events.js` / `sample.events` | 消费计数服务；收到 `sample.increment` 增加计数并发布 `sample.changed` |
| [非聊天视图](../extensions/examples/panel.js) | `/examples/panel.js` / `sample.panel` | 消费计数服务；按钮发布事件并同步刷新，释放时删除自己创建的 DOM/监听 |

执行 `npm ci`、`npm run dev` 后打开本地预览。应用菜单 → 扩展管理 → 安装扩展，依次填写上述 ID 与模块路径，安装并分别启用。服务先启用后事件/视图可工作；反向顺序会等待依赖。应用设置选择“计数样板”，从扩展管理点“返回工作区”，再点击“增加计数”。停用事件扩展后按钮不会递增，再启用事件扩展后可继续；停用服务会让依赖者等待，重新启用服务会创建新计数器。它是内存样板，不承诺保存计数或长期后台运行。

在已有服务消费者中替换提供者：先停用原提供者，再加载一个提供相同服务名及版本的新 ID 并启用。消费者重新激活，必须重新获取服务；不要把服务对象缓存到生命周期之外。缺失服务显示 `waiting` 与原因，重复提供者激活失败，不隐式覆盖。

## 宿主管理入口

管理集成使用 [Host 与 loadExtension](../modules/extension-host/host.ts) 的公开方法；扩展自身只获得 SDK 的 `ExtensionContext`，没有管理权限。应用外壳的安装路径持久化仍归外壳所有。

| 操作 | 当前保证与失败行为 |
| --- | --- |
| loadExtension(url, expectedId) | 加载默认导出、校验 ID 与 API；同源限制由应用安装入口执行，此函数不是网络安全策略 |
| install(definition) | 校验后只登记 disabled，不激活；重复 ID 拒绝，不能用它覆盖升级 |
| grant(id, capabilities) / start(id) | 仅授予已声明能力；启动等待缺失依赖/授权/平台能力，激活失败有诊断 |
| stop(id) | 取消任务并释放服务、监听、视图；依赖者等待；失败保留诊断且要求重启 |
| uninstall(id) | 必须先成功 stop（新安装且未启动也可）；串行撤销平台授权后才移除宿主记录。撤权失败保留记录，可重试；不删除模块文件、安装路径配置或用户数据 |
| 同 ID 重新安装 | 必须先卸载；重新授权才可访问同一状态作用域；不是热升级或自动迁移 |
| inspect / ids / manifest / serviceNames / views | 用于管理诊断；停用清理成功应无正常注册或任务 |

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
host.views(); // {id, label, owner, generation}[]
const close = host.mountView(viewId, root); // () => void | Promise<void>
```

管理查询未知 ID 会抛错；公开服务通过另一个声明 requires 的扩展 ctx.use 获取，管理者不直接读取内部服务表。管理操作 start/stop/grant/uninstall 串行执行；install 是同步登记。Platform 为注入适配器，测试可以实现 SDK 中的接口，不能把模拟结果当原生证据。

应用外壳仅为手动安装的扩展提供“卸载（保留数据）”：先停用、撤权，再保存安装路径移除结果，最后移除宿主记录。内置扩展只能停用；模块文件与扩展数据不删除。配置保存或撤权失败显示未完成，可重试；回执未知时须重载确认，不能把在途失败当作完整成功。升级需外部保留旧模块与数据、核对兼容再停用/卸载/重装。没有事务升级或自动回滚承诺，迁移工具与删除数据尚未实现。ESM 由环境缓存，同 URL 重新 import 不保证新代码；新版本使用新 URL 并记录来源。

## 状态、取消与演进

能力通过 manifest 声明并经授权后用 ctx.platform 调用。`state.read` 返回 null 或 `{revision, value}`；`state.write` 使用 `{revision, value}` 并返回提交回执。作用域为 `extension.<id>`，同 ID 重装保留原数据；未知 schema/修订冲突/超过 64 KiB 拒绝，不自动清空。不要在样板中存储凭据。业务状态结构和迁移由扩展明确设计，宿主不解析其业务对象。

ctx.task 跟踪异步任务，使用传入 signal 合作式取消；ctx.onDispose 管理其他资源。挂载函数返回自己的清理函数，视图关闭也会调用它。平台调用可以传操作信号；原生派发写入后不可取消，成功回执表示提交，未知回执先重新读取再决定恢复，不盲目重试。

实验期间破坏性 SDK 变更必须变更 apiVersion、记录迁移说明并测试旧版拒绝路径；服务破坏性变更提高服务版本，保留或明确移除旧提供者，不静默改变原版本语义。此处是演进规则，不承诺兼容窗口、自动迁移或无限资源。正式稳定、分发与平台支持按阶段证据另行声明。

## 验证边界

开发时执行 `npm test` 与 `npm run build`；浏览器安装/启停/视图及管理 API 验证使用隔离浏览器上下文。单元模拟平台不证明 Rust 撤权，浏览器不证明打包资源或真机行为。外壳卸载的 Mac 原生与 Android 指定模拟器结果见 [卸载验收](../evidence/UNINSTALL-2026-10-15.md)。其他平台和真机仍未验，普通包以交付摘要为准。

## 组合保存与恢复

外壳支持显式保存启用集合与精确扩展版本，下次启动恢复；权限须重新确认。提供者选择由集合确定，版本不符或缺失扩展保留原配置并显示诊断。配置所有权、部分恢复边界与卸载同步见 [组合契约](COMPOSITION.md)。

## 非敏感配置

通过 manifest.configuration 声明带默认值的 string/number/boolean 字段，activate 读取只读 ctx.configuration；外壳提供配置编辑、验证和持久化。示例与保存/重启/失败边界见 [配置契约](EXTENSION-CONFIGURATION.md)。普通配置禁止存放密钥或令牌，不提供凭据授权。counter/panel 当前为 1.1.0，旧组合需核对精确版本。

## 凭据代用请求实验

[接口与参考模型](CREDENTIAL-REQUEST.md)仅用于隔离假数据接入，生产能力不可用。扩展引用所属绑定，由平台侧确定目标和凭据；不在普通配置中保存秘密，真实适配及授权仍待独立阶段。

[公开生命周期隔离传输样例](HOST-TRANSPORT-EXPERIMENT.md)展示 ctx.task/ctx.platform 与停用、卸载和撤权的限定两端结果，仅测试包可用，不代表生产网络或凭据能力。

[可选单跳状态迁移助手](STATE-MIGRATION.md)已提供公开 SDK 入口与独立样板：扩展定义业务转换，助手用一次修订号提交保留旧快照；当前不自动迁移默认业务，也不提供通用包升级事务或自动回退。

可选 [固定视图树助手](VIEW-TREE.md) 已完成两作者内部样板与两端限定验收。仅测试外壳组合，默认应用未采用；不代表完整递归主题/导航框架或 Host 自动异步失败回退。

无业务视图事件服务的启停、撤权与恢复限定结果见 [执行边界](EVENT-SERVICE.md)；暂停映射为 stop，新一代重新订阅，不提供后台常驻或持久事件队列。
