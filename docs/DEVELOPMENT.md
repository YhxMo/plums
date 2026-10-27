# 开发与审查流程

[文档导航](README.md) · [验收矩阵](ACCEPTANCE.md) · [整体计划](spec/total.md)

状态：当前有效（2026-10-27 核实）；工作规则见 [AGENTS](../AGENTS.md)，本页是命令、门禁与交付的细节，命令以 [package.json](../package.json) 为准。运行数据、缓存与原始日志用隔离目录，不进入提交。

## 验证入口

- **门禁**：提交前运行 `npm run verify:web`（构建与类型、单元、Prettier、项目清单与导入边界、文件行数、ESLint）。原生改动加 `npm run verify:native`（IPC 契约、Rust 格式、Clippy、原生单元、第三方通知）；`npm run verify` 串联两者。浏览器回归 `npm run verify:e2e` 不在默认门禁中，界面与用户路径改动时运行。缺少工具或命令失败都单独记录，不算通过。
- **CI**：推送到 `main` 与拉取请求时，GitHub Actions（[ci.yml](../.github/workflows/ci.yml)）在 Ubuntu 上运行 `verify:web`，在 macOS 上分别运行 `verify:e2e` 与 `verify:native`（先构建前端供 Tauri 嵌入；Rust 固定为 1.98.1，升级工具链时同步修改）。云端通过不代替打包应用与真机验证。
- **本机**：Playwright 用 1 个 worker（Chrome channel），自起隔离 dev server，1420 端口被占用时失败而不复用；只有快速迭代可设 `PLUMS_E2E_REUSE_SERVER=1`，该结果不作为证据。Rust 构建与测试设 `CARGO_BUILD_JOBS=1 RUST_TEST_THREADS=1`。Mac 界面改动另跑相关 WebKit 回归，清空默认 channel：

  ```sh
  PLAYWRIGHT_CHANNEL= PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright" \
    npx playwright test --browser=webkit tests/web/dialog-keyboard.spec.ts --workers=1
  ```

- **版本号**只在 `package.json` 维护：`tauri.conf.json` 写作 `"../package.json"`，`src-tauri/Cargo.toml` 须写同一值，`check:release` 检查两处。
- **发布内容**：静态文件只来自 `public/`（品牌图与正式 `catalog.json`）；`extensions/` 下的开发目录、样板与故障扩展由开发服务器按原 URL 提供（`scripts/dev-extensions.mjs`，名单为 `vite.config.ts` 的 `developmentOnly`），不进入 `dist/`，`check:release` 确认这一点。
- **分块**：React、Markdown 库与其余第三方库各一块，扩展管理与模型连接页面按需加载（`lazy-pages.spec.ts` 确认打开前不加载）；Markdown 不按需加载，以免回复先以原文闪现。新增常驻页面前先考虑按需加载。
- **ESLint**：flat config，推荐规则、typescript-eslint 推荐规则（不含类型感知）与 React Hooks 两条规则，不管排版。TypeScript 固定在 typescript-eslint 支持的版本，升级前先确认其 peer 范围。以 `_` 开头的未用变量视为有意忽略。
- **导入边界**（`check:project -- --boundaries`）：用锁定的 TypeScript 解析静态与动态 import、export 和 require。`src`、`modules`、`extensions` 下每个文件都须归入一层（`scripts/check-boundaries.mjs` 的 `layers`）：通用层（SDK、宿主、`modules/shell`、`src/shell`、`src/features/extensions`、`src/components`、平台适配）不得引用业务模块；业务模块与默认 Agent 界面只能引用 SDK、自身与通用组件；只有组合根（`src/App.tsx`、`src/main.tsx`、`src/application.ts`）可接线全部。打包进应用的代码跨目录导入一律用别名 `@/`、`@modules/`、`@extensions/`（`../` 被拒绝）；`extensions/` 下的扩展原样加载，只能用相对路径。业务视图 ID 字面量不得出现在通用层。这不是运行时沙箱。
- **行数**（`check:size`）：超过 400 行只提醒，超过 800 行失败；按职责拆分，不为凑行数拆散内聚的代码。

## 界面组件

默认界面用 shadcn/ui（radix-nova 风格），源码在 [src/components/ui](../src/components/ui/) 由本项目维护，按需修改而不是另写同类组件；图标用 Lucide，可调分栏用 react-resizable-panels，跨组件的界面草稿用 Zustand，浮层提示用 sonner，不引入动画库。同类需求只用其中一个库；`components.json` 记录生成配置。视觉标准见[设计规范](DESIGN.md)。

## 上游依赖补丁

`npm ci` 的 `postinstall` 用锁定的 patch-package 应用 `patches/`，无法应用即失败；不要用 `--ignore-scripts` 跳过。改补丁后停止 dev server 并删除 `node_modules/.vite` 再做浏览器验收。

- **`@radix-ui/react-dismissable-layer@1.2.1`**（ESM 与 CJS）：Escape 时重查当前最高层，修复子层注册后父层旧监听未清理的竞态（[#4143](https://github.com/radix-ui/primitives/issues/4143)、[#4145](https://github.com/radix-ui/primitives/pull/4145)），并让每层都挂 Escape 监听、由重查决定谁处理（在另一个 React 根中打开的弹层，如记忆页，最容易遇到）；另让输入法组词中的 Escape 不关闭弹窗（上游 [#4153](https://github.com/radix-ui/primitives/pull/4153) 已合并，正式版发布后可从补丁删去）。移除补丁前须保留并通过 `model-connection-recovery.spec.ts` 的逐层关闭与焦点回归、`memory.spec.ts` 的刚打开即按 Escape、`input-method.spec.ts` 的组词取消回归。
- **`@radix-ui/react-focus-scope@1.3.1`**（ESM 与 CJS）：让 macOS 的 Option-Tab 进入首尾循环，保留普通 Tab、其他平台的 Alt-Tab、Ctrl／Command 组合与嵌套层暂停语义；另同步上游 #4153 的组词保护。Option-Tab 部分上游没有对应修复，是长期保留的原因。移除前须覆盖同样行为，保留 `dialog-keyboard.spec.ts` 与授权弹窗的按键回归。

## 修改原生命令

修改命令参数或响应后，先改 Rust 定义，再运行 `npm run ipc:generate`、`npm run verify:web` 与 `npm run verify:native`。

- `ipc:generate` 运行 Rust example 输出 `src/native/contract.generated.ts`，不启动应用；`ipc:check` 只比较导出与登记文件，漂移即失败。不能手改生成文件来通过检查。
- 新增命令用 `ipc_command!` 声明并加入 `lib.rs` 的 `native_commands!`；新增 wire DTO 用 `wire_object!`／`wire_enum!`，不另写 TS 数据模型。生产代码只经 `src/native/invoke.ts` 调用，项目门禁检查绕行；`tests/ipc-types.ts` 用 `tsc` 检查改名、漏参与错误状态等反例。
- **第三方通知**：`THIRD-PARTY-NOTICES.txt` 列出随 Mac 包分发的第三方依赖（前端生产依赖闭包与 `aarch64-apple-darwin` 上链接的 Rust crate）及许可证全文，由 `scripts/notices.mjs` 生成并随 `LICENSE` 放进包的 `Contents/Resources`。增删或升级依赖后运行 `npm run notices` 并提交；`notices:check`（在 `verify:native` 中）发现过期即失败。发布件不带许可证文件的包标为“no file”并给出源码仓库；复制进本仓库的 shadcn/ui 在脚本里手工登记。

## 证据与文档

- 证据放在 `evidence/`，记录源码提交（或 `npm run snapshot` 生成的源码清单）、工作区差异、平台、实际命令、结果与未验项。浏览器、原生开发进程、打包应用与真实设备分别留证。被新结果取代且不再被引用的证据删除，详细过程从 Git 追溯。
- 文档分工：[README](../README.md) 介绍项目与信任边界；[docs/README.md](README.md) 是索引；[ARCHITECTURE](ARCHITECTURE.md) 与子系统文档写当前边界与契约，只列回归测试、不记平台验证结果；[整体计划](spec/total.md) 与[当前阶段](spec/milestone.md)写路线与正在做的事；[HANDOFF](../HANDOFF.md) 写工程状态、未验范围与恢复入口；[RESULTS](../evidence/RESULTS.md) 写已交付包的受验范围。
- 当前文档平铺在 `docs/` 与 `docs/spec/`，首个 `##` 前写一行 `状态：`（计划写 `更新日期：`）；新增或移动时同步 `docs/README.md` 与全部引用。`npm run check:project` 校验索引覆盖、状态行、链接、锚点、空白与隐私模式。
- 完整愿景只存于根目录 `goal.md`（`.gitignore` 精确条目 `/goal.md`）；公开文档自含所需的工程摘要，不复制它。`.gitignore` 不是访问控制，提交前核对实际暂存内容。

## 本地交付目录

- 本地查看的应用包放在仓库根 `release/`（被忽略、不进源码盘点），只存当前交付、简短说明与校验清单，不放数据、缓存、日志或私人配置。
- `npm run release:mac` 构建 release 档位（开启 Tauri `devtools`，保留右键“检查元素”）、ad-hoc 签名、核对复制内容与文件校验，旧包整份归入 `.cache/archive/releases/`。包旁的 `build-info.json` 记录标识、版本、架构、签名与文件校验，`source.patch` 保存相对基线提交的工作区差异。
- 先验收再交付：`npm run release:mac -- --stage` 产出候选目录，在隔离数据下启动其中的 app；验收与独立审查通过后，关闭正在运行的应用，再执行 `npm run release:mac -- --publish <候选目录>`，只移动受验包、不重新构建。发布前核对候选的 `source.patch` 为空，且从它的源码提交到 HEAD 之间只改过文档与证据（`.md`、`docs/`、`evidence/`），否则拒绝。不带参数直接构建并发布，因此候选一律加 `--stage`。替换失败恢复旧入口并保留候选；这是本地包替换，不是数据迁移。
- **隔离数据**：开发命令把 `PLUMS_DATA_DIR` 指向 `.dev-data/`，该变量只在 debug 构建生效；release 包用设置了 `HOME` 的命令行启动包内可执行文件。桌面版单实例，开发进程与打开的包不能同时运行。数据目录与迁移见[架构](ARCHITECTURE.md#平台与数据目录)。
- **恢复**：`.cache/archive/INDEX.json` 记录已整理的历史材料与恢复方式；恢复前先关闭应用、使用隔离数据，恢复包不回滚应用数据。
- **清理**：确认没有构建或应用占用后，可删除 Rust 的增量产物、`dist/`、图标暂存与测试报告；保留 `node_modules/` 与下载缓存。`release/`、有效候选、历史备份、真实数据、隔离模拟器与 `goal.md` 不是构建垃圾；测试结束后删除该次验收的假数据与临时文件，不按目录年龄批量删除未知数据。
