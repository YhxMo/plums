# 防御性编程审查与收敛（开发分支增量）

日期：2026-10-17（Asia/Shanghai）。负责人：应用维护者；独立审查由未参与实现的审查者承担。范围：项目级防御性编程审查中“防御掩盖失败/静默降级”与门禁盲点的收敛，不新增能力、不修改公开 SDK 版本语义、不替换交付包。

## 源码与范围

开工基线为 `refactor/hardening` 的 `0e5d11429b2d7f24d98588644c43f55ce39b2c59`，工作区干净。受验工作区源码快照：[source-manifest-ddae54ae8252a9bbc0a7234a285edd0590da7d3133ad422931127b4b2c32d43c.json](source-manifest-ddae54ae8252a9bbc0a7234a285edd0590da7d3133ad422931127b4b2c32d43c.json)（308 文件，摘要 `ddae54ae8252a9bbc0a7234a285edd0590da7d3133ad422931127b4b2c32d43c`）。快照排除文档、证据和生成产物；结果绑定该工作区，不继承基线提交的旧绿测。

主要修正：

- 平台初始化探测失败不再等同“平台不支持”：`src/documents.ts`、`src/credentials.ts` 保留 `initializationError`；`runtime.ts`/`useOperations.ts` 汇总启动错误；文档与凭据区域显示失败原因与重载指引。
- 桌面外观不再丢弃窗口调用结果：`src-tauri/src/appearance.rs` 先取窗口再设置主题/背景，失败返回错误。
- Android 录入对话框及通用提示面板构建或显示失败按 `unavailable` 返回；录入恢复旧记录，路由/删除保留旧设置，仅在 logcat 记录异常类名；密钥写入线程内失败仍按 unknown 保留待核对。
- 启用等待提示与空诊断消息不再静默或重复标点；`initialize` 的空错误消息归一为可观察提示。
- 凭据管理区分 `unavailable`/`unknown`；`KeyResult::Unavailable` 与 `finish_key` 恢复旧记录；不支持平台的管理命令显式拒绝；`prepareUninstall` 不再把“未尝试”报成“回执待核对”。
- 视图挂载失败不再写入空布局哨兵；空/空白 layout 在解析层归一为默认界面；新增冷启动失败布局的浏览器回归。
- 诊断 `readActiveAgents` 与启用后的等待状态可观察；提示经 `messages.ts` 映射为中文。
- 激活超时与清理超时分文案，激活超时保留 `failed` 可重试；页面动态登记回滚刷新失败时保留首次错误；workbench 忙碌/待核对显式失败；`readPage` 未连接桥语义文档化并锁定。
- 门禁：E2E 默认自起隔离服务（`PLUMS_E2E_REUSE_SERVER=1` 才复用）；边界检查空候选失败；项目清单排除按路径锚定；固定 50ms 等待改为有界条件；themes 探针恒真 receipt 改为限定范围的 invoke 完成标记。

## 已执行检查

| 检查 | 结果与范围 |
| --- | --- |
| 全 Web 门禁 | `npm run verify:web` 通过：构建与 TypeScript、51 文件/488 单元、Prettier、项目/导入边界、行数、ESLint 全绿；对应源码快照所列工作区 |
| 浏览器全回归 | `npm run verify:e2e` 通过 120 项；默认自起 1420 dev server，未复用外部服务；含“失败首选布局不持久化空值”和“启用缺失依赖显示中文等待原因”用例 |
| 有界等待稳定性 | `npx playwright test tests/web/react-view-lifecycle.spec.ts --repeat-each=3` 12/12 通过（3 次全量该 spec） |
| Rust 单元 | `npm run native:test`：28 项通过，含 `KeyResult::Unavailable` 恢复旧绑定 |
| Rust 静态检查 | `npm run native:check`（Clippy `-D warnings`）通过 |
| Rust 格式 | `cargo +nightly fmt --check` 通过；默认 stable 未安装 cargo-fmt，`npm run native:fmt` 已尝试但返回失败（未进行格式检查） |
| Android 模板 | `npm test` 含 `tests/android-project.test.ts` 14 项：已知前版 Credentials 升级并用固定 SHA 钉住历史模板、未知代码拒绝等通过；仅生成逻辑，未编译 Kotlin |
| 文档与清单 | `npm run check:project`（含 `--boundaries`）与 `npm run check:size` 通过；行数上限人工降低后 0 超限 |
| 独立审查 | 三位未参与实现的审查者分别复核 TS/JS、Rust/Kotlin、测试/工具链；全部 P2 及后续 P3 修复均经定点复核确认关闭，无剩余 P1/P2 |

## 未验证与限制

- Android 工具链（`PLUMS_ANDROID_TOOLS_ROOT`）未设置、无 Java Runtime，修复后未执行 `android:build`；Kotlin 改动仅通过源码与模板生成测试核对，Android 编译和真机/模拟器面板异常行为未验。录入对话框的 `EditText` 构建与窗口标志设置仍在异常捕获之外，文档按“AlertDialog 创建/显示失败”限定范围，未扩大 try 覆盖。
- 原生凭据面板在 `supported=true` 且初始化失败时的渲染分支只经静态核对；浏览器环境无法构造该原生状态。
- 修复后的 Mac 原生窗口未启动，主题切换与失败注入均未实际执行。桌面外观仅有 Rust 编译/Clippy 和源码复核证据；浏览器主题测试不能替代此范围。
- stable rustfmt 缺失，`verify:native` 组合命令未通过；nightly 格式检查通过不等同于稳定工具链门禁。
- iOS、Windows、Linux 未构建；既有原生窗口/普通包/模拟器结论不因开发变更继承。
- 未执行真实凭据、外部网络或账户操作；`release/` 未替换。文档/证据/交接状态另行更新。
