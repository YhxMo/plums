# 启动界面与管理返回修复（2026-10-17）

状态：本小阶段已完成，两端同源受验原包已交付。负责人为应用维护者，独立审查者未参与实现。源码基线为 `9c05356` 加交付目录 source.patch；本期保留上一阶段未提交变更，精确修复前源码及差异保存在忽略目录 `.cache/ui-startup-2026-10-17/`。

## 反例与修复范围

- 历史无组合、无显式选择记录的 `layout: default` 会在启动后误报工作台未启用。旧配置采用 Agent 起始界面；启动不写存档，下一次成功保存随原业务一起提交。显式布局保存标记 `layoutIntent: explicit`，带标记、已存组合及其他布局 ID 的偏好保留，真实失效仍诊断。旧格式未记录选择来源；本兼容规则将无组合、无标记的 `default` 视为旧起始偏好，不根据 Agent 或消息内容猜测意图。
- 已有 Agent 未选中时重复显示欢迎引导。现在仅零 Agent 显示原欢迎双卡片；已有 Agent 的桌面右侧仅显示 88px、灰度和低透明度的原品牌图标，手机保留列表，选中后显示会话。
- 管理返回随外层内容滚出视口。现在页头置于滚动容器之外，列表和详情在下方滚动；业务挂载、草稿与焦点所有权不变。普通 Android 包发现全局 `.topbar-ghost` 覆盖了手机返回键尺寸，已限定提高页头返回键选择器优先级，原生复验为 44×44 CSS px，桌面仍为 32×32。

未改原生窗口配置、顶栏、正文尺度、列表/详情宽度、全局主题或品牌素材；网络/凭据仍为设计状态。

## 已执行检查

目标用例修复前 5 失败/1 通过，日志 `failure.log`；修复后连同既有窄屏及真实失效诊断用例共 8 通过，日志 `focused.log`。最终 `web-final.log` 包含新增的手机返回目标 44px 断言。`npm test` 为 36 文件/274 单元通过，`npm run test:web -- --workers=4` 为 110 通过；`npm run format:check`、`npm run check:project` 与 `git diff --check` 通过。原始材料均在上述忽略目录。

实际浏览器查看零 Agent 欢迎、已有 Agent 占位、管理滚到底、手机列表和会话。1180×820 下品牌中心与右侧内容中心一致；浅深两种主题管理返回坐标始终为 (24,75)，内容 scrollTop 1498，关键屏无横向溢出。截图 `zero-light.png`、`zero-dark.png`、`idle-light.png`、`idle-dark.png`、`manager-bottom-light.png`、`manager-bottom-dark.png`、`mobile-manager-bottom-dark.png`；几何记录 `visual-result.json`。

## 两端普通包受影响路径

最终 Mac 普通包为 `release/mac/Plums M1.app`，由 `npm run release:mac -- --stage` 构建并严格签名校验通过。使用隔离 `.m1-data/ui-startup-2026-10-17` 与自建两条消息，AX 原生操作和 CGEvent 滚动，不替换真实运行数据。旧偏好启动显示 Agent 列表和品牌占位，没有工作台警告，磁盘存档不变；首次切主题保存为 agents，角色和消息语义完全相同。浅深管理内容滚到底后返回坐标均为 (169,119)、32×32，直接 AXPress 返回保留未发送草稿。关闭后重开恢复 Agent 占位；另外两份隔离配置分别确认显式 default 仍有真实诊断、零 Agent 仍有欢迎双卡片，启动均未覆写存档。结果 `mac/result.json`、`mac/cold-result.json`；实际图 `mac/idle-light.png`、`mac/cold-restored.png`、`mac/cold-explicit.png`、`mac/cold-zero.png` 与两主题 `manager-bottom-*`、`draft-return-*`。

最终普通 Android APK 位于 `release/android/plums-m1-0.0.4-android-arm64-debug.apk`，以既有工具链执行 `npm run android:build`，APK v2 签名通过，调试证书与前交付相同。两端 source.patch 直接比较一致，最终运行源码相同；后续文档收尾不改变运行源码。未启用实验传输特性。

在原专用 ADB 5086 / emulator-5642 的 API36 ARM64 隔离实例安装最终 APK，原其他实例不参与。系统 Android16、WebView 133.0.6943.137、393px 视口。自建旧默认偏好启动为 Agent 列表，无错误欢迎/工作台警告、存档未变；选择 Agent 后会话可用。草稿用 WebView 观测/测试输入，管理入口、滑动与返回使用原生 ADB；实际滑动使管理内容 scrollTop 超过 2300，返回键在浅深两种主题均固定为 (20,85.73)、44×44 CSS px，再直接点击原坐标返回，草稿保留。首次保存后仍有原两条消息；force-stop 后 PID 4469→4788，浅色、角色和消息恢复、无工作台警告，存档未变。实际 PID 以 `android/cold-result.json` 为准；结果入口 `android/result.json`、`android/cold-result.json`，实际屏幕为同目录 `list-dark.png`、`manager-bottom-*`、`draft-return-*`、`cold-list.png`。

## 独立审查与交付

源码增量、恢复兼容、固定返回与 44px 覆盖、最终普通包及原生证据经独立审查，未见剩余 P1/P2。随后移动受验原包到 release，没有重新构建；实际收据为 `publish-result.json`。旧 Mac 完整目录保留在 `.cache/archive/releases/mac-dhVuMp/mac`，旧 Android 完整目录保留在 `.cache/archive/releases/android-34DH43/android`，恢复二进制不回滚应用数据。两端目录的 build-info.json 与 source.patch 保存来源与校验。交付后 Mac 实际入口使用隔离测试数据重新启动并确认 Agent 列表/品牌占位、无工作台警告，记录 `mac/delivered-window.txt`。

本期不重新计数未改 Rust/平台适配的专项实验，不将普通重开视为提交中崩溃恢复。Android 真机/其他配置、iOS、Windows/Linux、完整辅助技术、稳定 SDK、正式分发及真实网络/凭据继续待验。

本小阶段已[归档](../docs/spec/archive/M2-startup-management-fixes-2026-10-17.md)，网络与凭据仍处于[准备阶段](../docs/spec/milestone.md)。
