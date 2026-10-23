# 页面导航与文本处理工作台

[SDK 作者入口](SDK-AUTHORING.md) · [视图树](VIEW-TREE.md)

状态：当前有效（2026-10-17 核实）；页面导航与开发文本工作台的当前契约。

## 使用文本处理工作台

工作台与大写服务只随开发构建提供，发布包不含。从窄栏（手机为顶栏）的“扩展”进入扩展管理，启用“文本处理工作台”（`ui.workbench-board`），确认隔离状态读写权限，再返回工作区。新建处理项，填写名称和输入文本，点击“执行转换”。收到保存回执后，“查看结果”打开结果列表；结果详情支持返回和再编辑。草稿可显式保存，删除处理项需要再次确认。

工作台消费公开 `text.transform@1`，默认使用 Uppercase。点“更换服务”进入扩展管理，先停用 `transform.upper`，再启用另一个 `text.transform` 提供者（如开发构建中的 `transform.reverse`），重新启用的工作台读取原有处理项和结果。服务来源显示实际提供者名称。提供者缺失或权限未授予时，Host 按现有依赖语义暂停整个工作台，外壳保留管理入口和缺失原因；不会运行无效引用。

界面布局、业务表单、导航与结果详情属于工作台扩展。它没有消息时间线，也不使用 Agent 私有状态。数据保存在 `extension.ui.workbench-board`，结构版本为 1，容量沿用状态层的 64 KiB 限制。保存容量不足时保留上次成功快照；结果不自动截断或删除。未保存草稿在同一扩展生命周期内跨页面、跨布局保留；停用或重启前用“保存草稿”保留修改。

## 让扩展使用宿主入口

`ctx.shell.open("extensions" | "settings" | "diagnostics")` 打开宿主界面；它不授予权限，也不直接启停其他扩展。`open("extensions", id)` 在扩展管理中选中该扩展；`open("view", viewId)` 打开某个扩展贡献的 dialog 视图（例如从 Agent 详情打开模型连接页）；其他入口传目标会被拒绝。宿主通过 `Host.connectShell(bridge)` 接入自己的呈现与保存逻辑；未接入时 `open`/`savePage` 明确拒绝，`readPage` 返回 undefined（等同无偏好）。已停用的上下文不能再打开入口或写入页面偏好。

`ctx.shell.dependencies()` 返回本扩展及（递归）经 `ctx.use` 绑定的提供者，形如 `{ id, label }`，本扩展在首位；名称由外壳桥提供，未接入时为 ID。`ctx.providers` 取得的列表不算入依赖链。`ctx.shell.publishUsers(kind, users, toggle?)` 公布本扩展服务的对象（例如 `"Agent"` 与各 Agent 的 `{ id, label }`），整体替换上次公布，相同内容不触发刷新，停用时清除。每个对象可用 `uses` 列出它实际使用的提供者 ID；扩展管理把它列在依赖链或 `uses` 中每个扩展的详情里，也列在经 `ctx.use` 建在公布者之上的已启用扩展里（例如呈现 Agent 的界面扩展）。`toggle` 形如 `{ service, set(userId, extensionId, on) }`，`service` 须在 requires 或 optional 中：该服务的已启用提供者详情页列出全部对象，`uses` 含该扩展的为开启（实心），其余为关闭（虚线），点按后宿主校验并调用 `set`，由扩展自行保存选择；停用仍有使用者的扩展前，外壳确认并列出这些使用者。宿主只按依赖链、`uses` 与服务转交，不理解 kind 或 users 的业务含义。

`ctx.shell.readPage(viewId)` 读取页面偏好，`savePage(viewId, route)` 在宿主状态保存成功后完成。Host 自动以扩展 ID 与 viewId 组成键，业务内容仍由扩展另存。没有偏好返回 undefined；旧配置不需要增加 pages 字段。坏页面偏好结构拒绝启动并保留数据。并发写入沿用宿主串行保存与未知回执锁定。未连接宿主桥时 `readPage` 同样返回 undefined（等同无偏好），`open`/`savePage` 显式拒绝；接线错误须通过后两者暴露，不能把 undefined 当作“偏好为空”推断宿主已接线。

`ctx.view` 新增可选字段：

- `presentation: "workspace" | "dialog" | "sidebar"`：旧扩展默认 workspace；dialog 在扩展管理中所属扩展的卡片上以“打开 label”按钮出现（扩展启用时），不绑定特定业务 ID；扩展也可用 `ctx.shell.open("view", viewId)` 自行打开。
- `icon: string`：窄栏图标，一段 SVG 文本。根元素必须是带四个数字 `viewBox` 的 `<svg>`，UTF-8 不超过 8 KiB（`modules/sdk/view-icon.ts`）。宿主只把它当单色形状：以 `data:` URL 作 CSS `mask-image`、用当前文字色填充，当前项为 `--selection`、其余为 `--rail-icon`，因此 SVG 自带的颜色、样式、脚本、事件属性和外链都不生效或不执行；缺少 `xmlns` 时宿主补上。镂空用 `fill-rule="evenodd"`。注册时校验一次，不合格不影响视图本身：窄栏改用通用工作区图标，扩展管理详情的“界面图标”一行写明原因。不提供时同样使用通用图标。内置 Agent 界面也通过这个字段提供自己的对话气泡图标。
- `priority: number`：没有有效选中布局时，较高优先级优先，同级按 ID 排序。默认值 0。内置 Agent 布局声明 100；显式选中其他布局仍优先。
- `beforeLeave(): Promise<void>`：主动切换布局前结束在途操作。扩展也须在 disposer 中等待任务与页面释放，覆盖停用、卸载和失去依赖的路径。

旧 `View.mount(root)` 的同步返回 disposer 形式保持可用。外壳等待旧清理后才挂载替代者；清理失败的根不能再次挂载。外壳可以创建独立恢复根呈现其他正常布局，同时保留失败扩展的 `cleanup-failed` 与错误，不能称原扩展已清理。

## 在同一个视图中切换页面

`createPageRouter({ initialRoute?, save?, beforeLeave?, signal? })` 是可选 SDK 助手，复用 `resolveNavigation` 和 `mountViewTree`。它提供：

| 方法                                                     | 行为                                                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `register({id, route, label, priority, node})`           | 动态登记页面，返回 Promise，完成后得到异步移除函数；重复 ID 拒绝                                                     |
| `navigate(route, returnFocus?)` / `back(fallbackRoute?)` | 串行切换及返回；可显式给定返回焦点键，无历史时可用 fallbackRoute；先等待 beforeLeave，再保存偏好、清理旧树、挂载新树 |
| `reload()`                                               | 不改偏好或历史，清理并重新挂载当前页，适合切换同一页承载的业务对象                                                   |
| `mount(root)` / `detach()`                               | 挂载或等待清理后移除当前视图；detach 保留登记与历史，允许随后重新挂载                                                |
| `snapshot()` / `subscribe(listener)`                     | 返回当前页面、可用贡献、冲突、缺失偏好、忙碌与错误；订阅返回释放函数                                                 |
| `close()`                                                | 封闭入口并等待清理，重复调用返回同一结果；关闭后不能再次注册或导航                                                   |

未知保存路由使用可用页面回退，保留原偏好并显示 missing；不会自动把回退写回保存。用户显式导航且保存成功后才更改偏好。写入失败保持原页面。route 冲突沿用优先级降序、ID 字典序选择；获胜者移除后回退到同路由其他贡献，冲突信息可读。导航期间队列串行化，不并行清理/挂载。

每页使用 `ViewNode`，其 scope 支持 `signal`、`onDispose` 与嵌套 `mount`。页面可以继续声明面向其他作者的契约；SDK 不规定业务插槽。固定视图树本身的行为不变：同一棵树挂载结束后禁止追加子节点。动态增减发生在页面路由层，切换时完整释放上一棵树再创建新树。

使用 `data-page-focus="稳定键"` 标记可恢复焦点的控件，使用 `data-page-scroll="稳定键"` 标记页内滚动区域。返回时按路由恢复；键缺失则聚焦页标题或页面根。非聚焦点击可传入显式 returnFocus 键，不依赖 document.activeElement。所有页面监听应先登记 onDispose，再创建副作用。传入扩展 signal 可在停用瞬间封闭路由入口；关闭会先取消尚未就绪的挂载，再等待页面清理。清理失败锁住原路由器，不能无视错误继续替换。

## 向工作台贡献新页面

工作台通过普通版本服务 `text-workbench.pages@1` 公开 `register(page: PageContribution): Promise<() => Promise<void>>`，类型见 SDK 的 `PageContribution`。该服务只保证 register，不公开路由器的 navigate/snapshot；贡献者通过工作台正常导航打开页面。例如一个自有扩展可声明该依赖，贡献包含嵌套节点的页面，无须修改 Host 或应用外壳：

```js
export default {
  manifest: {
    id: "example.summary",
    version: "0.1.0",
    apiVersion: 1,
    requires: { "text-workbench.pages": 1 },
  },
  async activate(ctx) {
    const pages = ctx.use("text-workbench.pages");
    const remove = await pages.register({
      id: "example.summary.page",
      route: "summary",
      label: "概览",
      priority: 0,
      node: {
        id: "example.summary.container",
        async mount(root, scope) {
          const child = document.createElement("section");
          root.append(child);
          scope.onDispose(() => child.remove());
          await scope.mount(
            {
              id: "example.summary.content",
              mount(target) {
                const title = document.createElement("h1");
                title.textContent = "扩展概览";
                title.tabIndex = -1;
                target.append(title);
              },
            },
            child,
          );
        },
      },
    });
    ctx.onDispose(remove);
  },
};
```

开发样板见 [页面容器](../extensions/examples/local-proof-ui.js)与[页面贡献](../extensions/examples/local-proof-pages.js)。贡献在共享 WebView 中运行，根节点约束、权限提示和 DOM 归属不是恶意代码安全隔离。

## 取消、保存与验证边界

转换期间可取消；切换页面、布局或停用扩展会取消未提交转换并等待结束。已经派发的保存不能撤回，界面显示“等待保存”；成功回执胜出。未知写回执锁住修改，提示重新启用读取实际状态。失败保留输入和已保存结果。

浏览器、原生包与设备分别验收；具体候选结果见 [HANDOFF](../HANDOFF.md)，不以开发样板通过代替正式平台支持。
