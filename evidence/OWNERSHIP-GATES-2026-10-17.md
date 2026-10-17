# 状态所有权与门禁收敛（工作区增量）

日期：2026-10-17（Asia/Shanghai）。负责人：应用维护者；独立审查由未参与实现的审查者承担。范围：架构审查确认的状态交叉写入、原生状态写入阻塞、平台错误文案、命令清单双份维护与边界门禁覆盖。不新增能力、不修改公开 SDK 契约或状态格式、不替换交付包。

## 源码与范围

开工基线为 `refactor/hardening` 的 `1cb3b61a33514b3cf1d6faf5a8c34ee6f70d67eb`；开工时工作区已有未提交的计划文档改动，随后单独提交。受验工作区源码快照：[source-manifest-e7ad65708d798a479351a840e4737e3046cfe7ff62f97d86b64bb48a3cf8c4ce.json](source-manifest-e7ad65708d798a479351a840e4737e3046cfe7ff62f97d86b64bb48a3cf8c4ce.json)（310 文件，摘要 `e7ad65708d798a479351a840e4737e3046cfe7ff62f97d86b64bb48a3cf8c4ce`）。快照排除文档、证据与生成产物；代码差异为 22 个文件，351 增 131 删，已提交为 `c1624d5`（与证据、源码清单共 24 个文件）。

主要修正：

- 状态所有权：[useAppearance](../src/shell/useAppearance.ts) 的主题切换只写 `theme`/`themeId`；[useWorkspace](../src/shell/useWorkspace.ts) 的布局选择只写 `layout`；[extension-actions](../modules/shell/extension-actions.ts) 的组合保存只写 `composition` 与 `layout`。旧实现让每个动作夹带对方字段的渲染时旧值，保存排队时后一笔会把旧主题写回，造成界面深色、持久化浅色。
- 原生状态写入：[storage.rs](../src-tauri/src/storage.rs) 每次写入使用唯一的 `{owner}.{uuid}.pending`。固定临时名在崩溃残留后会让该 owner 的写入永久失败；审查指出的“写入前删除残留”方案在两个实例共用数据目录时可能提交对方写了一半的文件，因此未采用。
- 错误文案：[messages.ts](../src/shell/messages.ts) 映射浏览器与原生共用的 11 条状态拒绝英文文案。
- 命令清单：[lib.rs](../src-tauri/src/lib.rs) 默认与实验特性共用一份命令列表，实验特性只追加探针命令。
- 边界门禁：[check-boundaries](../scripts/check-boundaries.mjs) 改为按层规则，新增 `modules/extension-host` 与 `modules/shell` 起点，禁止 SDK、宿主、外壳和扩展引用业务模块；业务模块与 src 属于装配层，不作为起点。
- 小修：会话切换按会话身份滚底；角色卡文件读取复用 `readRoleCardFile`；角色卡设置复用 `useAsyncAction`；ESLint 注释如实说明 TS/TSX Hooks 未覆盖。

## 失败证据

| 修正 | 修复前结果 |
| --- | --- |
| 主题保存挂起时选择布局 | 新增 [theme.spec.ts](../tests/web/theme.spec.ts) 用例以伪造原生 IPC 挂起第一笔写入：界面 `data-theme` 为 dark，持久化 theme 为 light，断言失败 |
| 崩溃残留临时文件 | 新增 Rust 测试 `interrupted_temporary_file_does_not_block_later_writes` 失败，返回 `State temporary file unavailable; original preserved` |
| 提交失败只清理自身临时文件 | 将提交步骤抽为 `commit` 后，用非空目录占据目标令 rename 失败；删除清理语句的变异版本使 `failed_commit_removes_only_its_own_temporary_file` 失败，恢复后通过 |
| 平台状态英文文案 | [errors.test.ts](../tests/errors.test.ts) 新增映射用例首次运行 9 项失败 |
| 按层边界规则 | [hardening.test.ts](../tests/hardening.test.ts) 新增 11 项越层样本与空候选文案，首次运行 12 项失败 |

## 已执行检查

| 检查 | 结果与范围 |
| --- | --- |
| 全 Web 门禁 | `npm run verify:web` 通过：构建与 TypeScript、51 文件/517 单元、Prettier、项目/导入边界（484 文件、0 问题）、行数 0 超限、ESLint |
| 浏览器全回归 | `npm run verify:e2e` 121 项通过，默认自起 1420 dev server；含旧版布局迁移后切换主题的既有用例 |
| Rust 单元 | `npm run native:test` 30 项通过；`cargo test --locked --features native-transport-experiment` 36 项通过 |
| Rust 静态检查 | `npm run native:check` 与带 `--features native-transport-experiment` 的 Clippy `-D warnings` 均通过 |
| Rust 格式 | nightly rustfmt `--check` 通过；stable 工具链缺 rustfmt，`native:fmt` 未执行 |
| 独立审查 | 未参与实现的审查者两轮复核，均无 P1。首轮 3 项 P2（共享临时文件跨实例风险、误删 `__proto__` 用例、宏编译未证实）与 2 项 P3（2 条文案、组合保存夹带主题）已修复；复核轮 2 项 P2（清理测试在读取阶段提前返回而未覆盖清理分支、只读目录测试在特权运行下误报）已修复，前者经变异检查确认 |

## 未验证与限制

- TS/TSX 仍未执行 React Hooks lint：typescript-eslint 8.71.2 要求 TypeScript <6.1.0；本机 npm 缓存目录属 root，未安装新解析器，也未修改系统权限。Node 类型擦除不支持 TSX。
- 读取 revision、比对、写入在多实例下仍可能丢失更新；当前仅保证每次写入不提交其他写入者的临时文件。单实例或文件锁未决定。崩溃留下的 `{owner}.{uuid}.pending` 不会自动清理，会少量累积。
- 只读目录拒绝写入的 Rust 用例在特权运行（如 root）下跳过该断言，因为权限位不生效。
- 边界规则以名单列出业务模块，新增业务模块须同步规则；`import "../"` 归一为 `modules/` 时未被拒绝，非字面量动态 import/require 不在范围内。
- 修复后的 Mac 原生窗口未启动，Android 未编译；浏览器与伪造 IPC 结果不代表原生运行。
- 未执行真实凭据、外部网络或账户操作；`release/` 未替换。
