# 开发与审查流程

[文档导航](README.md) · [验收矩阵](ACCEPTANCE.md) · [路线图](ROADMAP.md)

状态：当前有效（2026-10-18 核实）；工作规则见 [AGENTS](../AGENTS.md)，命令与门禁细节以此文为准，命令以 package.json 与实际配置为准。

可用命令以 [package.json](../package.json) 与 [README](../README.md) 为准；运行数据、缓存与原始日志使用隔离目录，不进入源码提交。

## 验证入口

提交前运行 `npm run verify:web`，依次检查构建与类型、单元测试、Prettier、项目清单与导入边界、文件行数、ESLint。原生工具齐备时运行 `npm run verify`，串联 Web 与 `npm run verify:native`；后者依次核对 Rust 导出的 IPC 契约、执行 Rust 格式、Clippy 和原生单元。缺少工具或命令失败均单独记录，不作为通过。浏览器回归单独运行 `npm run verify:e2e`，不进入默认门禁。E2E 默认自起隔离 dev server，1420 被占用或来源不明时失败而非复用；只有快速迭代可显式设置 `PLUMS_E2E_REUSE_SERVER=1` 复用本地服务，该模式不作为证据。

ESLint 使用 flat config，对全部 JS/TS/TSX 启用推荐规则、typescript-eslint 推荐规则（不含类型感知规则）与 React Hooks 两条规则（均为错误），不承担排版。TypeScript 固定在 typescript-eslint 支持的版本；升级 TypeScript 前先确认其 peer 范围。以 `_` 开头的未用变量视为有意忽略；确需逐行豁免时写明原因。

`verify:web` 使用 `npm run check:project -- --boundaries`，复用已锁定 TypeScript 的 AST 检查 TS、TSX、JS、MJS 的静态路径 import、export、类型导入、动态 import 和 require。`src`、`modules`、`extensions` 下每个源码文件都必须属于一层，未归层即失败；层与允许目标见 `scripts/check-boundaries.mjs` 的 `layers`。通用层（SDK、宿主、`modules/shell`、`src/shell`、`src/features/extensions`、`src/components`、平台适配）不得引用业务模块；业务模块（`modules/agents`、`modules/text-workbench`）与默认 Agent 界面（`src/agents`）只能引用 SDK、自身与通用组件；只有组合根（`src/App.tsx`、`src/main.tsx`、`src/application.ts`）可接线全部。父目录桶入口（如 `"../"`）与仓库逃逸路径均拒绝。

业务视图 ID 字面量不得出现在通用层；R5 前仅诊断实验两个文件按名单豁免。源码解析失败、候选集合为空均失败。非字面量动态 import/require 和包名导入不在此仓库相对路径检查范围；这不是运行时安全沙箱。

完整门禁须在仓库根执行以覆盖所有源码与 SDK barrel；裁剪集合不能证明全仓边界。边界与 IPC 导入检查通过 `scripts/parse-sources.mjs` 使用 TypeScript 公开编译器 API 在内存中解析，不做类型解析或文件 I/O。普通 `npm run check:project` 仍只需 Node，检查清单、文档及隐私模式。

`check:size` 扫描项目源码清单的 TS、TSX、JS、MJS、Rust、Kotlin 和 CSS，默认上限 400 行；已有超长文件使用 [固定清单](../scripts/check-size.mjs)。以物理行数计数，末尾换行不增加空行；减少文件规模后人工降低上限，不自动更新或提高。清单包含测试，生成输出沿用项目清单的排除规则。

启动与声明校验复用 `modules/sdk/validation.ts` 和 `ContractError`：错误码表达类别，detail 保留字段路径，通用中文由 `src/shell/messages.ts` 映射；业务数据错误由提供者提供具体 message，外壳不按 Agent 等业务字段名翻译。已有开发调用需要英文诊断时，通过校验的 label／ContractError 的可选 message 保留原因；不要用裸错误码替代已对外提供的字符串诊断。Host 的配置、激活与清理错误在转为字符串前使用可选格式化回调，等待原因的既有前缀继续供诊断助手解析，界面显示时再映射。

## 已删除的传输实验

M2.3.1 TLS/JNI 隔离实验（`tests/tls-jni/`）与原生传输探针（`native-transport-experiment` feature、`transport_probe.rs`、`tests/{host-transport,native-transport,transport-fault}/`）已被生产 `credential.request` 取代，在 R5 删除；原件可从提交 `b27af7b` 取回，结果见[版本证据](../evidence/TLS-JNI-FEASIBILITY-2026-10-18.md)。

## 修改原生命令

修改命令参数或响应后，先更新 Rust 定义，再执行：

```sh
npm run ipc:generate
npm run verify:web
npm run verify:native
```

`ipc:generate` 运行已有工具链中的 Rust example，输出 `src/native/contract.generated.ts`，不启动应用或访问应用数据；依赖使用锁文件和本地缓存。`ipc:check` 只比较编译导出与登记文件，漂移即失败，不覆盖文件。缺少 Rust／缓存时先补工具条件，不能手改生成文件来通过检查。

新增命令使用 `ipc_command!` 声明实际函数，并加入 `lib.rs` 的 `native_commands!` 清单；原生注入参数保留在 Rust 签名中。新增 wire DTO 使用 `wire_object!`／`wire_enum!` 的当前受支持形状，不另写一份 TS 数据模型。声明、注册和导出共享同一名字；只改单侧名字会在 Rust 编译、生成漂移或 TS 调用检查失败。宏没有通用 schema 或运行时响应校验职责，未知结构需先补明确的序列化与失败样本。

生产代码通过 `src/native/invoke.ts` 调用，项目门禁检查直接／别名／namespace／动态导入的桥接绕行；原生环境判断仍可导入 `isTauri`。`tests/ipc-types.ts` 由 `tsc` 检查改名、参数名／类型、漏必填参数、响应缺字段和错误状态等反例。Rust IPC 测试核对注册集合、注入参数排除、可选参数与 serde wire 名称；`native-adapter.test.ts` 保留取消和无回执反例。普通包与设备验收仍独立进行。

## 工作流程

日常改动、交付候选与阶段退出的规则见 [AGENTS](../AGENTS.md)。要点：先有能失败的测试再实现；提交前跑对应 verify 命令；证据与独立审查只在替换 release 或宣布阶段完成时进行。

证据文件放在 `evidence/`，记录源码提交（或 `npm run snapshot` 生成的内容摘要清单）、工作区差异、平台、实际命令、结果与未验项。`snapshot` 排他创建 `evidence/source-manifest-<sha256>.json`，已存在时拒绝。浏览器、原生开发进程、打包应用与真实设备分别留证；跨编译只证明构建。

## 文档职责与索引

同一事实只在一个入口维护，其他位置链接而不复制。

| 文档 | 职责 |
| --- | --- |
| [README](../README.md) | 项目介绍、现在能做什么、快速开始与信任边界 |
| [docs/README.md](README.md) | 当前文档索引（每篇一行“何时读”） |
| [ARCHITECTURE](ARCHITECTURE.md) 与子系统文档 | 当前有效的边界、契约与实现映射 |
| [整体计划](spec/total.md) / [当前阶段](spec/milestone.md) | 路线与阶段门槛 / 正在做的事 |
| [HANDOFF](../HANDOFF.md) | 实际工程状态、交付与恢复入口 |
| [RESULTS](../evidence/RESULTS.md) | 交付候选与阶段证据索引 |
| [LESSONS](../LESSONS.md) | 经验与防再犯措施 |
| 归档目录 | 已完成阶段与退役实验原件，默认不加载 |

当前文档平铺在 `docs/` 与 `docs/spec/`，首个 `##` 前写一行 `状态：`（计划写 `更新日期：`）。新增或移动当前文档时同步 `docs/README.md`，新增归档时同步 `docs/spec/archive/README.md`，同一提交修正全部引用。`npm run check:project` 校验索引覆盖、状态行、链接、锚点、空白与隐私模式。

## 本地愿景文件与忽略规则

完整最终愿景只存于根目录 `goal.md`，根目录 `.gitignore` 使用精确条目 `/goal.md`，不忽略其他目录的同名文件。公开文档应自含贡献所需的工程摘要，不复制私人愿景全文，不以缺少该文件阻止阅读。

`.gitignore` 只影响 Git 对未跟踪文件的默认处理，不是加密或访问控制，也不会使已跟踪文件自动退出索引。提交前核对实际索引与忽略匹配；已跟踪的私人内容须单独处理索引及历史暴露。

## 本地交付目录

供本地查看的应用包统一放在仓库根 `release/`。此目录仅保存当前交付产物、精炼使用说明与校验清单，按 `/release/` 忽略并从源码盘点中排除；应用数据、缓存、原始日志、测试签名私钥及私人配置不进入交付目录。

Mac使用 `npm run release:mac` 统一构建普通debug包、本地临时签名、复制内容核对、文件校验及旧包归档；当前入口为 `release/mac/Plums M1.app`。同目录 build-info.json记录实际包标识、版本、架构、签名和文件校验，source.patch保存基线提交上的公开工作区差异；构建和签名通过不自动代表原生用户路径通过。Android当前包独立放在release/android，保留其受验来源，不因Mac更新而改写为同版验证。

需要先验收再交付时，执行 `npm run release:mac -- --stage`，读取命令输出的候选目录并在独立数据下启动其中的 app。通过验收和独立审查后，先关闭当前应用，再执行 `npm run release:mac -- --publish <候选目录>`，只移动这份受验包，不重新构建。省略参数直接构建并发布。候选与当前目录必须分开；发布保留整份旧平台目录，替换失败恢复旧入口并保留候选。此处是本地包替换，不是业务数据迁移或跨平台原子升级。

发布前核对 `build-info.json` 的源码提交/源码清单与本次受验源码一致，`source.patch` 可重放，校验和与实际包文件一致；工作区未提交差异、未验证的 Android/Mac 增量不得写成已交付。release 只保存当前受验产物，不保存构建缓存、秘密或运行数据。

旧Mac交付按整个平台目录归入 `.cache/archive/releases/`，保留原包及来源；历史实验归入同一归档根下的压缩包。`.cache/archive/INDEX.json`记录已整理历史材料的路径与恢复方式；后续 `release:mac` 自动归档由命令输出和 releases 目录定位。恢复二进制前先关闭对应应用，使用隔离数据；恢复包不回滚应用数据。未知文件、在用模拟器和调试签名材料保持原位置，不通过清理中断当前操作。

清理按用途区分，不以“被忽略”或“日期较旧”作为删除依据：

- 确认没有构建或应用占用后，可删除 Rust 的 `build/deps/incremental/.fingerprint/examples`、Android Gradle 的 `build/.gradle/.kotlin`、`dist/`、图标生成暂存和测试报告。后续构建按原命令重新生成，首次原生编译会更慢。
- 保留 `node_modules/`、Cargo/npm 下载缓存、Android 生成工程源码及 `.cache/android/debug.keystore`，避免无谓重装、丢失本地更新签名或破坏 JNI 链接。
- 开发命令把 `PLUMS_M1_DATA_DIR` 指向 `.dev-data/` 以隔离数据；该变量只在 debug 构建（含 Mac 本地预览包）生效，release 构建始终使用平台数据目录。桌面版单实例：数据目录相同或不同，第二次启动都只聚焦已运行的窗口，因此开发进程与已打开的预览包不能同时运行。
- `release/`、独立受验候选、源码差异/清单、被引用的日志/截图、`.cache/archive/`、`.dev-data/`、隔离模拟器数据与 `goal.md` 不属于构建垃圾。历史记录只移出当前入口并更新引用，不删除原有失败或未验证范围。

当前操作和版本从README、HANDOFF及RESULTS查阅。阶段历史与失败证据保持原件；入口文档不复制多轮PID、临时脚本路径和交付时间线。项目清单、链接及隐私模式通过check:project检查，原始日志／截图继续忽略。
