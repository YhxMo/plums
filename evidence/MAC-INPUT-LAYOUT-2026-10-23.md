# Mac 输入法、焦点与管理页布局候选（2026-10-23）

状态：开发候选验收记录；结果只证明下列源码与平台，不是交付。

## 来源

当时未提交的工作区，随后按主题提交为 `d797ed2`（Radix 补丁与源码差异）、`afe7c42`（凭据文件锁）、`0d72f19`（界面）与 `5c00e66`（文档）。打包候选在改名前构建，标识为 `dev.plums.m1.review`，包内可执行文件为 `plums-m1`；候选旁的 `source.patch` 记录当时相对 HEAD 的完整差异。

## 自动化

| 范围 | 实际结果 |
| --- | --- |
| Web | `npm run verify:web` 通过：858 单元，以及类型、构建、发布配置、格式、边界、行数与 lint |
| 打包源码 | `source-patch.test.ts` 覆盖超出进程缓冲上限的已跟踪与新增文件、删除项和完整回放；打包脚本将差异直接写入文件 |
| 原生逻辑 | 焦点补丁未修改 Rust；同份原生实现 `CARGO_BUILD_JOBS=1 RUST_TEST_THREADS=1 npm run verify:native` 的 IPC、格式、Clippy、68 单元通过 |
| Chromium | `npm run verify:e2e` 全量 224 项通过，1 worker |
| WebKit | 31 项通过：input-method / dialog-keyboard / application-flow / model-connection-recovery |
| 依赖补丁 | FocusScope 与 DismissableLayer 补丁经 `npm run postinstall` 应用，反向还原后重应用，ESM/CJS 语法检查通过 |
| 独立审查 | 文件存储、Popover、文档清理与管理页布局已审查；FocusScope、输入法 Enter/Escape 修复和相应回归的限定只读审查无可行动发现 |

## 打包应用实测

平台：macOS 27.0.1（26A434）arm64，隔离 `Plums Review` 0.2.0 debug，`codesign --verify --deep --strict` 通过。默认只有 3 个正式扩展。

- 管理页：960px 默认窗口的列表与右侧介绍、两个内置介绍的切换、明暗外观、系统半屏后内联详情、恢复原尺寸时保留所选扩展；管理页隐藏工作区侧栏按钮，返回工作区后恢复控件。
- 凭据文件与 Popover：此前隔离包已验证旧格式/引用、两处显隐和保存、留空编辑、退出重启及实际重构建后的三引用读取；文件为 0600，普通配置不含明文密钥，无 Keychain 授权。Popover 的点击、Enter、Escape 逐层关闭及返回焦点已在实际包验证，取消按压由浏览器回归覆盖。
- 授权弹窗焦点：初始焦点位于标题，当前系统设置下 Tab 依次访问关闭、暂不授权、授权并启动，正反向均首尾环绕；Option-Tab 和 Shift-Option-Tab 在两端同样环绕。焦点环清晰可见，Escape 与键盘取消均返回启用按钮，三个扩展仍停用。WebKit 自动化使用 Option-Tab 遍历全部控件；真实包与自动化的键盘设置分别按实际结果记录。
- 简体拼音：组词中的 Return 确认文本后留在草稿，再次 Enter 才单次发送；Shift+Enter 换行保留，组词期间 Option-Tab 保持原字段焦点。冷启动后输入 `nihao`，选择第 2 候选得到“你好”，草稿未发送；再次 Return 仅产生一条消息及一次本地回复。在“添加 Agent”名称字段输入 `ceshi`，第一次 Escape 只取消组词，弹窗保持打开且焦点留在名称；第二次 Escape 关闭弹窗并返回“添加”按钮。验收使用单独导入的无权限本地回显扩展，不连接真实服务。

## 未验

VoiceOver 暂缓（开关已恢复关闭、实用工具已退出，不记为通过）；真实模型调用；改名后的源码未重新打包验收。
