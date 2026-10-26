# 开发与审查流程

[文档导航](README.md) · [验收矩阵](ACCEPTANCE.md) · [整体计划](spec/total.md)

状态：当前有效（2026-10-23 核实）；工作规则见 [AGENTS](../AGENTS.md)，命令与门禁细节以此文为准，命令以 package.json 与实际配置为准。

可用命令以 [package.json](../package.json) 与 [README](../README.md) 为准；运行数据、缓存与原始日志使用隔离目录，不进入源码提交。

## 验证入口

本机 Playwright 使用 1 个 worker；浏览器回归与原生构建串行执行。Rust 构建与测试设置 `CARGO_BUILD_JOBS=1 RUST_TEST_THREADS=1`。Mac UI 改动除 Chromium 外还需相关 WebKit 回归，并在隔离打包应用检查实际交互；它们分别证明各自环境。

WebKit 使用现有 Playwright 入口，并清空默认 Chrome channel。浏览器缓存位于项目 `.cache/ms-playwright` 时，例如：

```sh
PLAYWRIGHT_CHANNEL= PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright" \
  npx playwright test --browser=webkit tests/web/dialog-keyboard.spec.ts --workers=1
```

提交前运行 `npm run verify:web`，依次检查构建与类型、单元测试、Prettier、项目清单与导入边界、文件行数、ESLint。原生工具齐备时运行 `npm run verify`，串联 Web 与 `npm run verify:native`；后者依次核对 Rust 导出的 IPC 契约、执行 Rust 格式、Clippy 和原生单元。缺少工具或命令失败均单独记录，不作为通过。浏览器回归单独运行 `npm run verify:e2e`，不进入默认门禁。E2E 默认自起隔离 dev server，1420 被占用或来源不明时失败而非复用；只有快速迭代可显式设置 `PLUMS_E2E_REUSE_SERVER=1` 复用本地服务，该模式不作为证据。

版本号只在 `package.json` 维护：`src-tauri/tauri.conf.json` 的 `version` 写作 `"../package.json"` 由 Tauri 读取；Cargo 无法引用外部文件，`src-tauri/Cargo.toml` 须写同一值。`check:release` 用 `scripts/versions.mjs` 检查两处。

发布包的静态文件只来自 `public/`（品牌图与正式 `catalog.json`）。`extensions/` 下的开发目录、样板、服务与故障扩展由开发服务器按原 URL（如 `/examples/counter/manifest.json`、`/examples/counter/main.js`）原样提供（`scripts/dev-extensions.mjs`，清单为 `vite.config.ts` 的 `developmentOnly`），构建时不进入 `dist/`；`check:release` 仍确认它们不在 `dist/`。

构建把 React、回复用的 Markdown 库与其余第三方库各分一块，扩展管理与模型连接页面按需加载（`React.lazy`），任一块不触发 Vite 的体积警告。Markdown 不按需加载：启动即显示会话，按需加载会让回复先以原文闪现。启动时只加载入口、React、Markdown、第三方库与运行时五块；`lazy-pages.spec.ts` 与 `model-connection-recovery.spec.ts` 确认两个页面在打开前不加载。新增常驻页面前先考虑同样按需加载。

ESLint 使用 flat config，对全部 JS/TS/TSX 启用推荐规则、typescript-eslint 推荐规则（不含类型感知规则）与 React Hooks 两条规则（均为错误），不承担排版。全局变量取自 `globals` 包：源码按浏览器环境，`scripts/`、`tests/` 与配置文件另加 Node 环境。TypeScript 固定在 typescript-eslint 支持的版本；升级 TypeScript 前先确认其 peer 范围。以 `_` 开头的未用变量视为有意忽略；确需逐行豁免时写明原因。

`verify:web` 使用 `npm run check:project -- --boundaries`，复用已锁定 TypeScript 的 AST 检查 TS、TSX、JS、MJS 的静态路径 import、export、类型导入、动态 import 和 require。`src`、`modules`、`extensions` 下每个源码文件都必须属于一层，未归层即失败；层与允许目标见 `scripts/check-boundaries.mjs` 的 `layers`。通用层（SDK、宿主、`modules/shell`、`src/shell`、`src/features/extensions`、`src/components`、平台适配）不得引用业务模块；业务模块（`modules/agents`、`modules/text-workbench`）与默认 Agent 界面（`src/agents`）只能引用 SDK、自身与通用组件；只有组合根（`src/App.tsx`、`src/main.tsx`、`src/application.ts`）可接线全部。父目录桶入口（如 `"../"`）与仓库逃逸路径均拒绝。打包进应用的 `src/` 与 `modules/` 跨目录导入一律用别名 `@/`（src）、`@modules/`、`@extensions/`，`../` 被拒绝，同目录用 `./`；别名在 `tsconfig.json`、`vite.config.ts` 与检查脚本三处一致。`extensions/` 下的扩展以文件原样加载、不经打包，只能用相对路径，使用别名即失败。

业务视图 ID 字面量不得出现在通用层；诊断实验的例外仅限脚本中的明确名单。源码解析失败、候选集合为空均失败。非字面量动态 import/require 和包名导入不在此仓库相对路径检查范围；这不是运行时安全沙箱。

完整门禁须在仓库根执行以覆盖所有源码与 SDK barrel；裁剪集合不能证明全仓边界。边界与 IPC 导入检查通过 `scripts/parse-sources.mjs` 使用 TypeScript 公开编译器 API 在内存中解析，不做类型解析或文件 I/O。普通 `npm run check:project` 仍只需 Node，检查清单、文档及隐私模式。

`check:size` 扫描项目源码清单的 TS、TSX、JS、MJS、Rust、Kotlin 和 CSS，以物理行数计数（末尾换行不增加空行），阈值见[脚本](../scripts/check-size.mjs)。超过 400 行的文件只列出提醒，改动时留意是否仍是单一职责；超过 800 行才失败。拆分以可维护性为准：按职责拆，不为凑行数把内聚的代码拆散或压缩写法。清单包含测试，生成输出沿用项目清单的排除规则。

启动与声明校验复用 `modules/sdk/validation.ts` 和 `ContractError`，错误码、字段路径、中文映射与等待原因的分工见[架构](ARCHITECTURE.md#当前前端的状态所有权)。

## 界面组件

默认界面统一使用 shadcn/ui（radix-nova 风格）组件，源码放在 [src/components/ui](../src/components/ui/) 由本项目维护，按需修改而不是另写同类组件；图标统一用 Lucide，动效用 Motion，可调分栏用 react-resizable-panels，跨组件的界面草稿用 Zustand，浮层提示用 sonner。同类需求只用其中一个库，`components.json` 记录生成配置。 颜色、阴影与动效的视觉约定见 [UI](UI.md#所有权与公开契约)。

## 上游依赖补丁

`npm ci` 的 `postinstall` 通过锁定的 patch-package 自动应用 `patches/`；补丁无法应用即失败。不要用 `--ignore-scripts` 跳过后直接构建。本地修改补丁后，停止 dev server 并移除 `node_modules/.vite` 预构建缓存，再开始浏览器验收；旧优化产物可能不会随补丁内容自动失效。

`@radix-ui/react-dismissable-layer@1.2.1` 的 ESM/CJS 补丁在 Escape 处理时重查当前最高层，修复子层注册后父层旧监听尚未清理的竞态（[上游问题 #4143](https://github.com/radix-ui/primitives/issues/4143)、[修复建议 #4145](https://github.com/radix-ui/primitives/pull/4145)）；并让每个层都挂 Escape 监听、由这次重查决定谁处理，否则新层在重新渲染认定自己最高之前收不到 Escape（在另一个 React 根中打开的弹层，如记忆页，最容易遇到）。该补丁也让 `isComposing` 或 `keyCode === 229` 标记的 Escape 留给输入法，避免取消组词时关闭弹窗；这一部分上游已合并（[#4153](https://github.com/radix-ui/primitives/pull/4153)，2026-10-12），2026-10-23 核对时仅发布于 `1.2.2-rc`，正式版发布后可从补丁中删去。界面仍使用标准 Popover，不增加全局键盘拦截或延迟。升级到包含上游修复的版本后移除补丁，并保留 `model-connection-recovery.spec.ts` 中注册时 Escape 只关闭新层、逐层关闭与焦点回归，`memory.spec.ts` 中刚打开即按 Escape 的回归，以及 `input-method.spec.ts` 的组词取消回归；移除补丁前须同时满足这些行为。

`@radix-ui/react-focus-scope@1.3.1` 的 ESM/CJS 补丁让 macOS 的 Option-Tab 进入原有首尾循环，同时保留普通 Tab、非 Mac 的 Alt-Tab、Ctrl/Command 组合键与嵌套层暂停语义；不修改系统偏好或给按钮增加 tabindex。另同步上游已合并、尚未正式发布的 `isComposing` / `keyCode === 229` 保护（[#4153](https://github.com/radix-ui/primitives/pull/4153)，2026-10-23 仅有 `1.3.2-rc`），循环逻辑不接管输入法组合中的 Tab。Option-Tab 部分截至 2026-10-23 上游没有对应 issue 或 PR，是本补丁长期保留的原因；上游接受同等行为前不能移除。Mac 键盘约定见 [Apple 说明](https://support.apple.com/zh-cn/guide/safari/cpsh003/mac)。升级时核对上游是否同时覆盖这些行为，再移除补丁；保留 `dialog-keyboard.spec.ts` 和授权弹窗的真实按键回归。

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

日常改动、交付候选与阶段退出的规则见 [AGENTS](../AGENTS.md)，本节只补充证据文件的做法。

证据文件放在 `evidence/`，记录源码提交（或 `npm run snapshot` 生成的内容摘要清单）、工作区差异、平台、实际命令、结果与未验项。`snapshot` 排他创建 `evidence/source-manifest-<sha256>.json`，已存在时拒绝。浏览器、原生开发进程、打包应用与真实设备分别留证；跨编译只证明构建。

## 文档职责与索引

保留、删除与“同一事实只维护一处”的原则见 [AGENTS](../AGENTS.md#改动与文档)；本节是各文档的分工与检查方式。

| 文档 | 职责 |
| --- | --- |
| [README](../README.md) | 项目介绍、现在能做什么、快速开始与信任边界 |
| [docs/README.md](README.md) | 当前文档索引（每篇一行“何时读”） |
| [ARCHITECTURE](ARCHITECTURE.md) 与子系统文档 | 当前有效的边界、契约与实现映射；只列回归测试，不记平台或打包应用的验证结果 |
| [整体计划](spec/total.md) / [当前阶段](spec/milestone.md) | 路线与阶段门槛 / 正在做的事 |
| [HANDOFF](../HANDOFF.md) | 实际工程状态、开发候选的验证结果与[未验范围](../HANDOFF.md#未验范围)、交付与恢复入口 |
| [RESULTS](../evidence/RESULTS.md) | 已交付包的受验范围与证据索引 |

当前文档平铺在 `docs/` 与 `docs/spec/`，首个 `##` 前写一行 `状态：`（计划写 `更新日期：`）。新增或移动当前文档时同步 `docs/README.md`，同一改动修正全部引用。有效规则归入 AGENTS 或本页，不维护独立经验流水账；能力未完成不能通过删文档变成已完成。`npm run check:project` 校验索引覆盖、状态行、链接、锚点、空白与隐私模式。

## 本地愿景文件与忽略规则

完整最终愿景只存于根目录 `goal.md`，根目录 `.gitignore` 使用精确条目 `/goal.md`，不忽略其他目录的同名文件。公开文档应自含贡献所需的工程摘要，不复制私人愿景全文，不以缺少该文件阻止阅读。

`.gitignore` 只影响 Git 对未跟踪文件的默认处理，不是加密或访问控制，也不会使已跟踪文件自动退出索引。提交前核对实际索引与忽略匹配；已跟踪的私人内容须单独处理索引及历史暴露。

## 本地交付目录

Mac API Key 使用独立凭据文件，不需要创建本地签名身份。当前本地预览仍使用 ad-hoc 签名；正式分发的 Developer ID 与 Apple 公证属于后续发布准备。

供本地查看的应用包统一放在仓库根 `release/`。此目录仅保存当前交付产物、精炼使用说明与校验清单，按 `/release/` 忽略并从源码盘点中排除；应用数据、缓存、原始日志、测试签名私钥及私人配置不进入交付目录。

Mac使用 `npm run release:mac` 统一构建普通debug包、ad-hoc签名、复制内容核对、文件校验及旧包归档；当前入口为 `release/mac/Plums.app`。同目录 build-info.json记录实际包标识、版本、架构、签名和文件校验，source.patch保存基线提交上的公开工作区差异；构建和签名通过不自动代表原生用户路径通过。Android当前包独立放在release/android，保留其受验来源，不因Mac更新而改写为同版验证。

需要先验收再交付时，执行 `npm run release:mac -- --stage`，读取命令输出的候选目录并在独立数据下启动其中的 app。通过验收和独立审查后，先关闭当前应用，再执行 `npm run release:mac -- --publish <候选目录>`，只移动这份受验包，不重新构建。省略参数直接构建并发布。候选与当前目录必须分开；发布保留整份旧平台目录，替换失败恢复旧入口并保留候选。此处是本地包替换，不是业务数据迁移或跨平台原子升级。

发布前核对 `build-info.json` 的源码提交/源码清单与本次受验源码一致，`source.patch` 可重放，校验和与实际包文件一致；工作区未提交差异、未验证的 Android/Mac 增量不得写成已交付。release 只保存当前受验产物，不保存构建缓存、秘密或运行数据。

旧 Mac 交付按整个平台目录归入 `.cache/archive/releases/`，保留原包及来源。`.cache/archive/INDEX.json`记录已整理历史材料的路径与恢复方式；后续 `release:mac` 自动归档由命令输出和 releases 目录定位。恢复二进制前先关闭对应应用，使用隔离数据；恢复包不回滚应用数据。早期 `mac-0.0.4-2026-10-16` 与 `mac-titlebar-2026-10-17` 备份缺少完整 bundle 资源签名，不作为严格签名校验通过的回退基线。未知文件、在用模拟器和调试签名材料保持原位置，不通过清理中断当前操作。

清理按用途区分，不以“被忽略”或“日期较旧”作为删除依据：

- 确认没有构建或应用占用后，可删除 Rust 的 `build/deps/incremental/.fingerprint/examples`、Android Gradle 的 `build/.gradle/.kotlin`、`dist/`、图标生成暂存和测试报告。后续构建按原命令重新生成，首次原生编译会更慢。
- 保留 `node_modules/`、Cargo/npm 下载缓存、Android 生成工程源码及 `.cache/android/debug.keystore`，避免无谓重装、丢失本地更新签名或破坏 JNI 链接。
- 开发命令把 `PLUMS_DATA_DIR` 指向 `.dev-data/` 以隔离数据；该变量只在 debug 构建（含 Mac 本地预览包）生效。桌面版单实例，开发进程与已打开的预览包不能同时运行。正式数据目录与改名前旧数据的迁移见[架构](ARCHITECTURE.md#应用数据目录)。
- `release/`、有效候选及其来源文件、历史应用备份、真实运行数据、隔离模拟器与 `goal.md` 不属于构建垃圾。测试完成后删除该次验收专用假数据、临时脚本、测试包与缓存；不按目录年龄批量删除未知数据。真实未验项保留在 HANDOFF 的未验范围，过期过程不继续归档。

当前状态和版本从 README、HANDOFF 及 RESULTS 查阅；入口文档不复制多轮 PID、临时路径和交付时间线。项目清单、链接及隐私模式由 `check:project` 检查，原始日志／截图继续忽略。
