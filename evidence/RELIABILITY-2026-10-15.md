# M1 状态、停用与焦点回归

日期：2026-10-15 UTC。实现与验收负责人为本地维护执行者；独立审查由未参与实现的独立执行者承担。基线 HEAD 为 `9a070af38252a8834e64878bce97c00dcd49908d`，以下结果针对该提交后的工作区修复。受验源码集合、逐文件摘要、产品 diff、夹具、原生产物及日志摘要见 [元数据](reliability-2026-10-15.json)。源码集合 SHA-256 为 `16cf1bbbb4fa0adcf424a804253ffa64e0df71d83d6a81ba2b95aeb1e9f5aa99`，含 95 个实现、测试、脚本及配置文件，不含文档/证据。

## 修复与反例

| 项目 | 修复前证据 | 修复后行为 |
| --- | --- | --- |
| F1：输出可恢复性 | 32,001 字符、数字和 undefined 三项反例失败：服务返回值可进入保存路径，违反恢复约束 | Agent 扩展在保存前验证字符串与 32,000 UTF-16 代码单元上限；非法输出保留已存状态和草稿，合法边界可保存恢复 |
| F2：普通停用/撤权重入 | 两个旁支在取消同步通知及异步清理窗口中仍处理事件；stop/revoke 两项反例失败 | 首次取消前关闭整个受影响图，随后串行释放；失败所有者仍锁存。新增两入口全 SDK 菱形图检查，保留异步清理与重新启用正例 |
| F3：返回焦点 | 非聚焦激活添加弹窗的 Escape/关闭，以及移动详情嵌套弹窗，共三项浏览器反例失败 | 显式记录发起控件；消失的菜单项使用稳定菜单按钮；嵌套弹窗各自返回 |
| V1：设置错误反馈 | 原缺陷判定撤回；已有设置框内 alert，定向验证通过 | 不新增重复提示；布局/主题写入失败、偏好保持及解除故障后重试通过 |
| D1：文档 | 架构/实验/验收入口仍含旧版当前状态，角色卡与文件选择范围表述过时 | 当前入口链接分版本证据，区分实验子集、长期目标及历史包 |

原始反例日志位于忽略的 `.cache/reliability/unit-before.log`（5 失败、12 通过）和 `web-before.log`（3 失败、1 通过）。它们仅证明当时反例，不作为最终版本结果。

## 已执行验证

| 命令或操作 | 结果与范围 |
| --- | --- |
| `npm test` | 64/64，7 文件，退出 0；含三个失效入口的菱形图及 SDK 入口检查 |
| `npx playwright test --config .cache/reliability/playwright.config.ts` | 40/40，退出 0；Chromium、独立上下文及端口 1426，不复用既有 1420 服务。配置继承项目配置，仅覆盖 testDir/outputDir、端口与 workers=2 |
| `npm run build` | TypeScript 与 Vite 通过；最终运行 bundle 为 `index-BnCEwki1.js` |
| `npm run format:check` | 通过 |
| `npm run check:project` / `git diff --check` | 129 文件、22 文档、206 内部链接，无问题；空白检查通过 |
| Mac / Android 普通调试构建 | `npm run native -- build --debug --bundles app` 与配置既有工具链后的 `npm run android:build` 均通过；不是普通包完整运行复验 |
| 最终原生夹具构建与运行 | 下述两端通过，产物摘要分别保存；夹具不进入普通 catalog 或 release 交付目录 |

Rust 源码未修改；既有 6 项 Rust 结果仍仅绑定历史版本，此次未重跑 Rust 单元、Clippy 或 rustfmt。新的原生桥接行为由打包夹具单独实测。

## 原生夹具配方与观察

将 `tests/fixtures/native-reliability.ts` 用现有 Vite 以 ES library、target es2022 构建，复制到普通 `dist` 的隔离副本 `fixtures/native-reliability.js`，仅在该副本 catalog 添加 `reliability.check`。产品运行 bundle 与普通构建一致。Tauri 配置覆盖 frontendDist 指向副本、beforeBuildCommand 为空；Mac 另改产品名/标题为 Plums Reliability、标识为 `dev.plums.m1.reliability`，Android 保留生成工程标识 `dev.plums.m1`。原生代码及产品代码无夹具专用分支。

使用项目锁定 Tauri CLI 执行 `build --debug --bundles app --config <fixture-config>` 和 `android build --debug --target aarch64 --apk --config <fixture-config> -- --locked`。本地配置及构建日志保留于 `.cache/reliability/`。复现须使用专用进程及数据目录/模拟器克隆：夹具随机生成状态 owner，但生命周期检查仍修改实验 `extension.root` 的内存授权；不要在使用中的普通应用进程执行。

- **Mac 27.0.1 / arm64**：独立数据目录 `.m1-data/reliability-20261015`；原生 UI 绑定完整夹具 app 路径，启用夹具并点击运行。4 项状态边界检查、stop/revoke × 正常/失败清理 4 项检查返回 passed。最终包由 PID 30379 重启为 31209，再输入旧 owner 执行只读恢复：revision=2、length=32000、passed=true。恢复断言检查结构、修订与长度，不声称逐字节完整性。
- **Mac 真实窗口焦点**：添加按钮打开弹窗，Escape 后 AX 显示焦点回到同一按钮；Return 重新打开，关闭按钮关闭后仍返回该按钮。非聚焦点击和嵌套详情的完整矩阵另由浏览器反例覆盖。未把桌面观察推广到移动触控。
- **Android 16 / API 36 / arm64-v8a / WebView 133.0.6943.137**：专用只读 AVD 克隆，ADB 5044、emulator 5566。安装最终夹具 APK，通过 WebView 调试测试入口直接导入 `runNativeChecks`，实际调用 Rust Broker；4 项状态及 4 项生命周期检查通过。从设备应用目录读取保存文档，revision=2、length=32000。终止 PID 2302 并重启为 2435，调用 `verifyNativeRestore` 通过，设备文件前后一致。此为自动原生运行检查，不是 UI 点击、真实触控或真机结果。

两端生命周期原生夹具覆盖两个旁支的同步取消通知、正常清理、主动抛错及失败后禁止重启；原生完整菱形图、全部 SDK 入口、异步清理窗口和清理超时未逐一实测，相应更广覆盖属于单元测试。普通 0.0.4 包既有运行范围仍见 [历史 UI 证据](UI-ANDROID-0.0.4.md)，此次未替换 release 中的普通交付包。

## 审查、限制与交接

独立源码审查覆盖产品修复、浏览器边界用例、最终原生夹具与菱形图参数化，无阻塞发现。产品 diff SHA-256 为 `2e5452b99649deebacd7bdccb2ec6b390094405b3368fc79b1378a35858fcc8c`。精简审查保留最小守卫、共用 invalidate 与显式焦点传递；没有引入无调用路径支撑的抽象。

浏览器仍输出既有 React 嵌套 root 同步 unmount 警告，40 项断言通过，未据此宣称所有渲染时序均无问题。成功删除发起控件后没有专门的后备焦点策略；当前验收关闭/取消路径，不扩大为完整无障碍验收。设置故障反馈此次仅有浏览器定向运行证据，未新增两端原生注入实测。

状态总容量仍为 64 KiB；32,000 长度合法不保证累计快照可保存。完整迁移、崩溃恢复、原生提交竞态与未知回执、真机及其他平台不在此次通过范围。M1 整体仍开放，iOS 继续暂缓并阻塞既定退出门槛；下一阶段收敛选型与限制，见 [当前计划](../docs/spec/milestone.md)。

验收结束后关闭专用 Mac 夹具进程、Android 模拟器及 ADB；5044/5566/5567/9234 无监听。隔离数据、克隆及原始证据保留，原 release 应用与 1420 开发服务未关闭。
