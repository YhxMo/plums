# Plums 桌面扩展宿主 v1

桌面提供安装、注册、运行、授权与恢复。角色卡的内容由外装扩展解释；聊天、模型适配、Agent 循环、工具和 MCP 协议不内置。空应用只有 Agent 管理、角色卡、扩展和设置页面。

首次交付目标为 macOS 13.5+ Apple Silicon。桌面、宿主及 SDK 为 0.1.0；core 与 CLI 保留独立的 0.2.0 API。全仓构建使用 Node **26.5.1**、pnpm 10 和 Xcode Command Line Tools；单独使用 core/CLI 仍支持 Node 22+。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm examples:build
pnpm desktop:dev
pnpm desktop:package
pnpm desktop:smoke
```

打包脚本从 Node 官方发行目录下载 26.5.1，核对 SHA-256，随应用附带独立 Node，避免 Electron 与隔离库的原生 ABI 混用。Electron 44.5.1、isolated-vm 7.0.1 固定版本。产物位于 `release/Plums-darwin-arm64/Plums.app`、`release/Plums-0.1.0-arm64.dmg`。本地应用采用临时签名；开发者签名、公证、自动更新尚未接入。

## 管理界面

管理页顶部保留 Agent、角色卡、扩展和设置四个入口；当前 Agent 选择器和文件导入位于同一外壳。角色卡、扩展页管理公共库库存；服务接入以扩展标签呈现，当前 Agent 的配置、停用、移出集中到详情页。Agent 卡片进入详情页，统一查看组件、权限摘要、工作目录和最近执行记录。公共库显示组件的 Agent 使用名单，并提示已入库的新版本。

界面使用本地内联图标与系统字体，以石墨暖灰为主色，柠檬黄标记当前导航、待配置状态及每屏唯一的开始使用入口。保存、创建和导入使用石墨主按钮；角色卡、扩展和连接器分别使用蜜桃、薄荷和天蓝分类色，类别同时用文字说明。浅色和深色主题跟随系统变化，原生主窗口背景同步更新；无需联网或单独设置外观。

macOS 系统标题栏隐藏，红绿灯与品牌图标、五项导航合入 56px 顶栏；顶栏与页面同色，滚动后才显示细分隔线。空白区域可拖动窗口，按钮与选择器可正常交互；全屏时收回红绿灯的左侧留白。安全确认窗口也保留原生关闭按钮与独立的 36px 拖动区，「允许」使用石墨按钮，不使用柠檬黄行动按钮。

窄视口下顶部操作区重排，五项导航在自身区域横向滚动且文字不折行，页面内容和表单保持可读；原生窗口最小宽度仍为 900px。首次读取数据显示骨架和加载提示，失败提供重新加载入口；刷新时保留已有数据，搜索无结果时保留搜索框。键盘焦点清晰可见，减少动态效果偏好会关闭悬停与按压位移。

默认隐藏组件标识、调用参数 JSON 和原始审计；设置页的开发者模式仅改变这些内容的显示。操作分别记录等待状态与错误，一个组件的操作不会禁用其他组件或导入入口。配置、组装、导入和调用错误留在对应弹窗；后台刷新失败单独显示重试入口，已完成的保存不因此被当作失败。成功保存、导入和加入组件时显示短暂反馈；删除、移出、停用和解除目录绑定使用说明后果的管理弹窗。

独立安全确认窗口使用临时沙箱会话，不提供管理或 SDK 桥，禁止联网、导航、弹出窗口和系统权限。窗口只接受当前主框架及一次性令牌的答复；默认焦点在「不允许」，Enter、Escape、关闭、失焦、加载失败和请求取消均拒绝；任务有效期下拉框内的 Enter 只操作原生选项，其他位置（包括允许按钮）仍拒绝。Tab/Shift+Tab 遍历全部可用控件并循环，空格切换范围或在就绪按钮上批准，焦点外逸回到拒绝按钮。允许按钮延迟启用，宿主同时检查 600ms 等待时间。请求按 FIFO 呈现，排队请求也可取消；能力入口原有 120 秒预算、权限复核和审计保持。

`desktop:dev` 会在被忽略的 `.artifacts/desktop-dev/` 中准备构建产物及宿主原生依赖链接，开发和打包均由独立 Node 运行 broker。

## 安装和使用

在角色卡、扩展页面导入组件到**公共库**，无需先创建 Agent。统一文件选择与拖拽支持独立 Plums ZIP、角色 JSON、带角色数据的 PNG，以及完整 Agent 组合 ZIP。公共库只保存组件和元信息，不启动代码、不授予权限。

主要流程面向非程序员：导入第三方 Agent ZIP，选择「这是完整的 Agent，直接使用」，导入完成立即弹出配置页。宿主根据组件自己的设置表单集中展示模型名称、API Key、接口地址等必要设置；保存后用独立的宿主安全窗口集中确认权限，并按依赖顺序统一启用已组装组件、打开工作界面。拒绝权限时保留配置页，未填写必要配置时不启用；已经配置并启用的 Agent 点击「开始使用」直接打开。

ZIP 导入也可选择「我还要补充功能，继续组装」：仅将包内组件登记公共库，不创建、不运行 Agent；保留名称、组件选择、默认卡和工作界面进入创建流程。缺少依赖的组合 ZIP 仍必须通过所有路径、累计大小、清单和入口检查，只能先收藏组件并补齐；完整安装路径拒绝缺依赖组合。

需要定制时，在 Agent 页面点击「创建 Agent」，命名并按角色卡、扩展分组（服务接入作为扩展标签）选择组件及版本。宿主自动补齐公共库中兼容的必需组件，保留显式选择的版本；缺少兼容组件时说明需要先导入什么，不要求用户理解启用顺序。支持空 Agent、无角色卡或多张角色卡；默认卡和工作界面可留空。创建后进入同一个配置、权限与开始流程。已有 Agent 从详情页点击「编辑组合」，可加入、移出组件、显式更新版本，以及修改名称、默认卡和工作界面。已有组合的加入、移出与版本更新立即保存，名称失焦或回车保存，默认角色卡和工作界面选择变化即保存，并显示「已保存」。保存失败保留名称输入；新建 Agent 的选择仍是草稿，点击「创建 Agent」才提交。无工作界面时进入同一个 Agent 详情页。组件在 Agent 详情页单独停用或移出；公共库只管理库存。

公共库按 SHA-256 保存不可变组件制品。相同制品去重，每个 Agent 固定绑定选定制品；同一 Agent 不允许重复包 id。新导入版本不会自动更新其他 Agent。组件更新统一从公共库选择：先导入新版本，再在详情页或组合编辑器点击「有新版本 · 更新到 vX」，没有文件直更入口。公共库允许先导入缺依赖的组件并显示提示，创建或修改组合时检查必需依赖与版本范围。被 Agent 引用的制品不能直接从公共库删除。

JSON 角色卡仅要求有效对象，不解释业务字段；PNG 按公开规范提取 `chara`、`ccv3` 的 base64 JSON（同时存在时优先 `ccv3`），检查结构、CRC、编码及大小，拒绝没有角色数据的普通图片。原始文件保存在生成的 character 包 `source/card.json` 或 `source/card.png`，payload 为原始 JSON，未知字段保留。宿主不提供内容编辑器，角色解释与编辑由外装扩展负责。[角色卡规范](https://github.com/malfoyslastname/character-card-spec-v2)、[V3 规范](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md)

共享的只有组件文件。安装、同意、启用、设置、密钥、MCP 批准和运行数据仍按 Agent 隔离。Agent 记录保存组件摘要绑定；`bundle.zip` 只是导入/导出制品，不是 Agent 存在的前提。旧 Agent 首次打开时从**实际已安装版本**迁移绑定和公共库制品，保留授权、设置、密钥、数据及组合未知字段。提交成功才切换记录格式；失败保留旧数据并在管理页显示恢复提示。

Agent 详情页可绑定、更换或解除组件声明的逻辑目录名（示例使用 `workspace`）、查看执行记录和原始审计（开发者模式），并导出和删除 Agent。`agent-data` 为实例私有目录，不能由用户覆盖；桌面库目录及其父子目录不能作为工作目录授权。工作目录更换或解除绑定会停止相关运行并重新建立 core；解除后不再允许访问该逻辑目录，目录内文件保留。

默认使用系统 DNS。若代理把公网域名解析为保留地址，可以在设置中选择「公共加密 DNS (Cloudflare)」。此选项把**域名查询**发送到 Cloudflare，采用固定公共地址和 TLS 验证；不发送组件请求体或凭据。系统和加密 DNS 模式都拒绝内网、回环、链路本地、保留、映射与过渡地址，不把代理假 IP 视为可授权公网地址。[Cloudflare DoH 接口](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/)

运行界面顶部保留 40px 宿主栏，提供返回和停止，并将原生红绿灯移到栏内；返回管理后恢复导航栏位置。薄荷圆点表示运行中，减少动态效果偏好会关闭呼吸动画。返回管理仅隐藏工作视图，调用和事件继续运行，可通过运行中的入口继续；停止会销毁工作视图并取消该 Agent 的运行。SDK 的 `openManager()` 和返回管理菜单也保留运行。原生菜单始终提供返回管理、切换 Agent、停止运行和恢复界面。快捷键为 `Cmd+Shift+M` 和 `Cmd+.`。扩展崩溃/超时只影响自己的子进程；前端崩溃或无响应会撤下工作视图并返回管理。

## 组合包格式

根目录 `agent.json`：

```json
{
  "bundleVersion": "1.0",
  "id": "my-agent",
  "name": "My Agent",
  "version": "1.0.0",
  "character": "components/character.zip",
  "extensions": ["components/workspace.zip"],
  "connectors": ["components/service.zip"],
  "startup": "workspace"
}
```

`character` 可选，引用默认角色卡；`characters` 保存其他角色卡，三个组件列表允许为空。默认卡可以替换或清空。`startup` 是扩展的包 id。组件继续使用 core 的 character/extension/connector 三类格式；可运行组件必须是 2.x。引用必须是 ZIP 内安全相对路径；入口、类别、重复 id、依赖版本在写入前验证。

组合包与所有组件累计限制为 20 MiB 解压内容、1000 个文件/目录条目、255 字符路径。外层嵌套 ZIP 文件的大小也计入预算。路径穿越、符号链接、大小写碰撞、文件/目录冲突被拒绝。整包安装先在新实例 staging 完成，成功才发布；下次启动清理未发布的 staging。组件变更使用持久恢复记录；恢复完成前不运行相关实例。

外层未知字段和附加文件、组件未知字段均保留。导出从 core 的已安装组件重建，执行密钥检查；不带设置值、会话、运行数据或密钥。组成包版本属于发行包，组件版本可由管理页显式更新。

## 桌面声明和 SDK v1

宿主与管理界面共用 `@plums/sdk/settings` 的 `missingRequiredSettings(description)` 判断必填配置缺项。该纯函数接收 core 的 `SettingsDescription`，按密钥配置标记、缺值和空白字符串判断；`false` 与 `0` 是有效值。此入口可在浏览器中使用，无需加载组合包的 Node.js I/O；实际设置仍由 core 校验。

组件在自己的 payload 命名空间登记：

```json
{
  "plumsDesktop": {
    "sdkVersion": "1",
    "runtime": "runtime/main.js",
    "frontend": "ui/index.html",
    "contributes": {
      "commands": [
        { "name": "run", "title": "运行", "inputSchema": { "type": "object" } }
      ],
      "tools": [{ "name": "read", "title": "读取" }],
      "connectors": [{ "name": "request", "title": "请求服务" }]
    }
  }
}
```

只有扩展可提供前端。运行入口为构建后的 ES Module；静态 import 仅支持组件内部相对 JS 文件，不支持 Node、npm、网络 import 或动态 import。运行文件导出 `activate(sdk)`，在其中注册声明的接口；可选 `deactivate()` 在停止时获得最多 500 毫秒的清理机会，崩溃时不能保证调用。初始化阶段不能发起 I/O、委托调用或 MCP 发现。

```js
export function activate(sdk) {
  sdk.register("commands", "run", async (input) => {
    const role = await sdk.character(); // 不透明原始 payload
    const settings = await sdk.settings(); // 无密钥值与引用
    const result = await sdk.capability("files", {
      kind: "fs",
      operation: "read",
      path: input.path,
    });
    await sdk.emit("updated", { completed: true });
    return { role, settings, data: result.data };
  });
}
```

SDK 包 `@plums/sdk` 提供类型、声明验证、组合包创建与验证。运行时 SDK 包含 `register`、`invoke(packageId, kind, name, input)`、`capability(permissionId, request, mcpTool?)`、`character(packageId?)`、`characters()`、`settings`、`emit`、`onEvent(topic, handler)`、`mcpCheck`。委托只能访问声明的依赖，不能循环；调用深度最多 16，I/O 权限按完整调用链交集授权。事件只投递当前实例已启动的扩展；处理事件时保留发布者调用链，事件不能提高接收方权限。`characters()` 只返回当前 Agent 已启用角色卡的 id、名称和版本；`character(id?)` 读取已启用卡的原始 payload，省略 id 读取默认卡，没有可用默认卡时返回 null，显式读取未启用/其他 Agent 的卡被拒绝。参数不能选择其他实例或覆盖宿主身份。

前端为任意框架的构建后 HTML/CSS/JS。页面使用 `window.plums`：`context()`、`invoke(kind,name,input,packageId?)`、`onEvent(callback)`、`cancel()`、`openManager()`。它只拥有当前实例及当前前端扩展的身份，没有管理 IPC、文件、密钥或直接联网接口。

每扩展独立 Node 子进程，V8 isolate 默认内存 64 MiB，同步执行预算 5 秒，宿主 RPC 等待不计入预算；进程 RSS 超过 256 MiB或心跳停止会终止。只用复制的 JSON 数据桥接，不把 Node、Electron、isolated-vm Reference/对象交给客体。超时/崩溃后需返回管理重新运行。

## I/O、安全与审计

前端使用沙箱 WebContentsView、独立非持久 Session、contextIsolation、无 Node 集成。CSP 与网络拦截禁止直接联网、框架嵌套和外部脚本；仅允许自身已验证 HTML 页面的导航和静态资源读取，外部导航、弹窗、浏览器权限拒绝。授权由独立原生窗口显示，包前端不能创建宿主批准。参考 [Electron 安全机制](https://www.electronjs.org/docs/latest/tutorial/security)。

权限只来自组件 manifest。首次启用同意与任务范围分别处理：开始使用时在独立可信窗口选择本次读取、列目录、写入、服务联网权限子集和有效期（默认 15 分钟，可选 1 小时），显示已绑定项目目录；范围内连续执行，未选中的能力需要单次确认。停止、撤权、升级、配置或目录变化后重新批准。未启用任务范围的兼容模式下 read/list 不询问，write/HTTPS 每次询问，单次确认默认 120 秒；缺失、拒绝、超时和非布尔 true 都不执行。确认后、放行审计后重新检查安装/启用、权限、路径、调用链和 MCP 指纹。执行前审计失败不调用 Sink；执行后的失败保留 `callId/phase/executionState`，不能自动重试 unknown/completed。

文件 Sink 通过固定原生辅助进程执行，目录句柄逐级 `openat`、拒绝符号链接及非普通文件，macOS sandbox 限制选定真实根，不能调用任意程序。文件 I/O 20 MiB 上限。命令执行、本地 stdio MCP 未注册。

HTTPS 只允许清单域名，检查所有解析地址，连接时固定地址并保留 TLS 主机验证；不自动跟随重定向。支持请求/响应头、取消和有限流式事件（`io.chunk`），请求/响应各 20 MiB、总时限 120 秒。流式事件包含实例、扩展身份；宿主跨数据块脱敏。响应完成后返回汇总结果。持续不结束的 SSE 会到期取消，示例只使用有限响应。

连接器可声明 `credentials: [{permissionId, setting, header, prefix}]`。setting 必须是自己的 x-secret 设置，permissionId 必须是自己的 egress 权限。宿主按绑定注入请求头；普通前端和扩展不能读取密钥明文。密钥使用 Electron safeStorage 异步加密，只把密文写入实例私有文件；系统加密不可用时拒绝保存，没有明文回退。

数据库升级为 5，新增 2.x MCP 批准表；迁移保留已有安装、同意、启用、历史密钥引用和旧 MCP 数据。2.x 用 `checkMcpToolsV2`（必须提供完整列表）、`approveMcpToolsV2` 和 `runDelegatedCapability(...mcpTool)`；指纹包含名称、描述和 inputSchema，消失/变化撤销批准。旧动作、旧 MCP、原 extension-only `runCapability` 契约保持。

## 外装示例与验收

- `plum-chat.zip`：独立聊天界面、角色解释、模型适配、工具循环和会话保存。模型连接器配置支持 Chat Completions 的模型名称及有效 API 密钥。模型未配置时不发起请求；真实模型对话需要用户凭据。
- `paper-board.zip`：另一套纸上看板界面和实例私有 JSON 数据。
- 单独的角色卡、聊天/看板扩展、HTTPS 与远程 MCP 连接器 ZIP 可先独立导入公共库，再加入 Agent；不随桌面自动安装。
- HTTPS 示例访问 example.com。MCP 示例为 Streamable HTTP，默认 DeepWiki 公共服务器，完整分页发现、指纹批准后工具调用；远程端点域名仍受组件权限限制。

`pnpm desktop:smoke` 启动打包后的实际应用，在独立临时库中分别拖拽 JSON、PNG、扩展和连接器，手动创建空 Agent 及看板 Agent，验证自动选择角色卡与工作界面、统一启用拒绝与通过，再导入聊天组合 ZIP，检查立即弹出的模型配置及必填校验，并验证 ZIP 继续组装分支、组合偏好即时保存、返回保留运行、SDK 返回、继续及停止后重新打开。测试通过真实安全窗口按钮分别允许和拒绝确认，验证真实目录读/列/写、目录解绑的取消与确认、解绑后拒绝访问且文件保留、重新绑定恢复访问，以及实例数据、HTTPS、远程 MCP、直接联网拒绝及渲染进程崩溃恢复。测试会显式选择公共加密 DNS，输出截图及结果到 `release/smoke/`。内核和宿主 Vitest 使用假/记录 Sink 隔离业务外发；Electron UI 测试验证主题、四种宽度、焦点、操作状态隔离与请求竞态，独立确认测试验证发送者、令牌、按键默认拒绝、延迟允许、FIFO 和取消；示例模型工具循环也用记录响应回归。

系统钥匙串实测单独执行 `PLUMS_TEST_KEYCHAIN=1 pnpm desktop:smoke`，仅保存自造测试密钥。macOS 可能要求用户处理系统授权；自动化不能代替此授权。默认 smoke 不访问钥匙串，存储接口拒绝不可用的加密服务并限制等待时间，没有明文回退。

桌面每次构造执行 core 都固定采用 `capabilityApproval: "task-or-confirm"`：未被有效范围覆盖的读取和列目录也单次确认。停止、前端 cancel、配置/目录变化或宿主重启会丢弃临时 grants；内部 core 重建不会恢复独立核心的隐式只读默认。
