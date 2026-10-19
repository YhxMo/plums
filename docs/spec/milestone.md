# 当前阶段计划

[整体路线与退出条件](total.md#m2-子门禁) · [工程状态](../../HANDOFF.md) · [M2 退出清单](M2-EXIT-CHECKLIST.md)

更新日期：2026-10-19（Asia/Singapore）。状态：执行中——**真实路径优先**。M2.0 重新基线、P6/P1/P7/P2 工程前置与 M2.3.1 TLS/JNI 实验已完成并归档（见[归档索引](archive/README.md)）。本阶段先让默认 Agent 能真实对话、修复违反架构原则的结构问题，再由使用反馈推进 M2.1/M2.2。负责人为应用维护者。

当前两端交付仍绑定标签 `m2-baseline-2026-10-18`（`015ac2d`），来源见[重新基线证据](../../evidence/BASELINE-2026-10-18.md)。

## 为什么调整顺序

2026-10-18 全项目审阅发现：默认 Agent 的回复仍是本地示例服务，没有一条真实有用的用户路径；默认 Agent 通过外壳私有保存入口持久化，扩展管理器内含 Agent 特判，边界门禁未覆盖 `src/features`、`src/components`；所有会话消息挤在 64 KiB 单快照；TypeScript 7 使 TS/TSX lint 全部失效；原 M2.3 为一次请求规划的安全矩阵超出当前可信扩展模型的需要。开放性只能在真实使用中检验，因此先打通真实路径。

## 工作包

按顺序执行；每项先写能失败的测试，完成后 `verify:web`（及相关 `verify:native`/`verify:e2e`）通过即提交。

| 编号 | 内容 | 状态 | 退出条件 |
| --- | --- | --- | --- |
| R1 工具链 | TypeScript 回退到 typescript-eslint 支持的版本，恢复 TS/TSX 与 React Hooks lint（原 P4） | 完成：TypeScript 6.0.3 + typescript-eslint 8.71.2；边界/IPC 检查改用公开编译器 API | lint 覆盖 `src`/`modules`/`tests` 的 TS/TSX；故意的 Hooks 违规样本被拒绝；现有违规逐项修复 |
| R2 原则修复 | 边界门禁覆盖全部 `src`；Agent 改用自身 `state.*` 命名空间并迁移旧数据；Agent 损坏不阻断启动；Agent 类型移出 SDK；扩展管理器去 Agent 特判；诊断改用结构化错误；`host.ts` 按职责拆分（原 P3） | 已完成：门禁已覆盖全部源码并要求每个文件归层；Agent 契约与界面移出 SDK/通用组件；扩展管理不再展示 Agent 关联；Agent 改存自身命名空间并迁移旧数据，损坏只使 `agents.local` 失败；等待原因改为结构化 `inspect().wait`，诊断不再解析文本；`host.ts` 拆出 scope/registry/context（660→455 行）；ID 与同源校验收敛到 `sdk/validation.ts` 的 `identifier`/`sameOrigin`，测试禁止重复定义 | 补洞后的门禁先在旧代码上失败再修复；坏 Agent 数据下应用可启动、管理可用、坏数据保留；旧快照中的 Agent 迁移后可用 |
| R3 存储与多实例 | 桌面单实例（原 P5）；会话消息按会话分片存储；Broker 拒绝保留名；提交补目录 fsync、读前检查大小、清理陈旧临时文件；重录密钥后删除旧引用 | 已完成：Broker 所属者限定为 `host.shell`/`extension.<id>`，提交同步父目录（失败报 unknown 的 `state-sync`），读前检查大小，启动清理一小时前的 `.pending`；`state.*` 支持 `key` 分片与 `remove`，Agent 改为索引 + 每会话分片（单元测试覆盖累计超过 64 KiB 的多会话保存与恢复）。桌面单实例已接入：debug 包以隔离数据目录连续启动两次，第二个进程立即以 0 退出、仅首进程保留（2026-10-18，macOS 本机；Android 不适用）；`PLUMS_DATA_DIR` 只在 debug 构建生效；重录密钥确认保存后尽力删除旧引用（Bindings 单元测试覆盖部分删除与当前引用不被移除；系统钥匙串/Android Keystore 的真实删除未在本阶段运行；Android 目标已随 R4 编译） | 累计超过 64 KiB 的多会话可持续保存；第二实例聚焦首实例；保留名 owner 被拒绝 |
| R4 真实连接器 | 最小安全集（见下节）接通 `credential.request`，DeepSeek 扩展进入目录、默认不启用 | 已完成：Mac（reqwest + rustls 平台验证器 + Keychain）与 Android（Kotlin `HttpsURLConnection` + Keystore）实现并接入生产适配器；每 owner 单请求、每绑定修订首次发送原生确认、取消/停用/撤销中断在途、交付前复核授权与修订；DeepSeek 进入目录（安装不启动、不授权）。单元测试覆盖注入头、3xx 不访问跳转目标、超限、超时、明文 HTTP 拒绝、载荷校验零原生调用；Android debug APK 编译通过（Kotlin 传输无单元测试）。Mac 真实调用已完成（2026-10-18，账户所有者用 `4657f25` 构建的 debug 包经 Agent 发送一条消息并收到 DeepSeek 回复）；随后只读扫描应用数据、WebView 与缓存目录，密钥模式与 Bearer 头零命中，统一日志中该进程近 3 小时无条目（日志无密钥未被正面证明）。Android 模拟器真实调用随后由账户所有者完成（2026-10-18）。未验：Android 应用数据与 logcat 的无密钥扫描（扫描时模拟器未运行）、Kotlin 传输单元测试 | 单元测试覆盖重定向/超时/超限/取消/未授权零发送；Mac 普通包与 Android 模拟器各一次真实调用；WebView 存储与日志无密钥 |
| R5 产品清理 | 诊断与故障注入只在开发模式出现；生产目录移除故障样例；`dist` 只含运行所需扩展；合并两套文本工作台；无入口的 probe 删除或移出类型检查；应用标识去掉阶段名 | 已完成（偏差：e2e 仍经开发构建的诊断面板注入存储故障，诊断接线 `useExperiments`/`DiagnosticActions` 仍在边界豁免名单；二者都不进入发布包）：诊断菜单与面板、故障布局与样板目录（`catalog.dev.json`）、示例与契约文件已只在开发构建出现；旧外部工作台（`workbench`/`ui.default`/`ui.board`）与逆序服务移入开发目录，发布包只保留内置文本处理工作台、大写服务与 DeepSeek 连接，`npm run check:release` 在构建后检查 `dist`；被生产 `credential.request` 取代的传输实验（Rust feature、探针命令、实验 IPC 契约、TLS/JNI 与三个传输探针页）已删除。应用显示名改为 Plums（系统标识 `dev.plums.plums`、数据目录与浏览器存储前缀保持不变，最终标识在准备发布时一次确定），开发数据变量改为 `PLUMS_DATA_DIR`。其余探针页（文档、事件服务、导航、恢复界面、状态迁移/恢复、主题、界面组合）仍对应现有功能的原生验证，保留在 `tests/` 并参与类型检查 | 生产构建菜单无故障注入；`dist` 不含示例与测试扩展；e2e 不依赖诊断入口 |

R4 涉及真实密钥与外发：密钥由账户所有者在原生面板录入；调用前确认测试账户、每端次数（各一次）、`max_tokens` ≤ 256，不自动重试。

## R4 最小安全集

- 秘密只在原生层读取并注入请求头，不返回 WebView、不写日志或状态。
- macOS：Rust `reqwest`（rustls + 平台验证器）+ Keychain 读取。Android：Kotlin `HttpsURLConnection`，复用凭据插件的 Keystore 解密，不走 JNI。
- 仅绑定的固定 HTTPS 目标；禁止重定向与系统/环境代理；连接 10 秒、总计 30 秒；请求 4 KiB、响应 8 KiB；每 owner 1 个并发。
- 每个绑定首次发送需用户在宿主确认，可撤销，进程内有效；绑定变更、停用、卸载后失效。
- 失败保留草稿；结果未知不自动重试；可随时切回本地服务。

DNS 公网固定、OS 证书吊销联网边界、显式代理传输、授权世代与受控 CA 夹具移入[整体计划的后续加固](total.md#后续加固)，不阻塞本阶段。详细契约以[凭据请求契约](../CREDENTIAL-REQUEST.md)为准，R4 实施时同步精简。

## 第 7 步：外部作者写扩展（进行中）

尚无项目外作者，由所有者扮演作者，结果记为“所有者作为作者的首次试用”，不计作 M3.1 的独立作者。交付候选（两端构建、独立审查、证据、替换 `release/`）移到本步收尾，连同试用反馈的修复一起作为阶段退出。

- 7a 本地导入：完成。打包应用可选择或拖入单个 .js 文件导入（源码按哈希存入外壳状态，Blob URL 加载，CSP 只加 `blob:`）。Android 模拟器已验证系统文件选择、导入、对话与强制停止后恢复；Mac 包的选择、拖放与重启恢复未自动验证（本机终端无辅助功能权限），并入 7d。
- 7b 作者入门：[AUTHOR-QUICKSTART](../AUTHOR-QUICKSTART.md) 与起步模板。
- 7c 内部预演：一个只读公开文档的新会话写出文本服务与带状态的笔记界面，两者经真实导入路径运行通过。卡点已修入入门文档（写入修订号与回执、界面规则、返回值限制、重启后需保存组合）；仍待产品决定的是导入扩展重启后默认停用、带权限扩展每次启动须重新确认；manifest 已可写显示名称 `name` 与纯文本说明 `description`。
- 7d 前清理：发布包只保留 `agents.local`、`ui.agents` 与 DeepSeek 连接；大写服务与文本处理工作台移入开发构建。内核新增可选服务依赖 `optional`，Agent 在没有文本服务时照常启动并提示启用。
- 模型连接（2026-10-19）：`connector.models` 取代 `connector.deepseek`，支持 OpenAI 兼容与 Anthropic 协议、多条连接、按 Agent 选模型并发送会话历史与角色说明，见[模型连接](../MODELS.md)；长期记忆 `memory@1` 在其后。
- 7d 所有者试用：待进行；Mac 上导入一个使用凭据绑定的连接器并真实调用一次。
- 7e 收尾：`evidence/AUTHOR-TRIAL-<日期>.md`，按 M2.1 契约缺口 / M2.2 作者与 UI 缺口 / 文档问题归类，排定下一批工作。
