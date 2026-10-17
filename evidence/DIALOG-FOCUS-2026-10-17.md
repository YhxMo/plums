# 弹窗初始焦点修复

日期：2026-10-17（Asia/Shanghai）。负责人：应用维护者；独立审查者未参与实现。范围为普通弹窗关闭按钮的初始状态、悬停和键盘焦点，以及关闭后的焦点返回；此前已确认 UI 继续沿用。

## 源码与修复

受验源码为 `9c05356de46409d199a35f4eeff2831a23c8bba9` 加两端交付目录内同一份 `source.patch`。构建后的补充改动仅涉及文档及产物外的验收元数据，未修改产品实现。修前公开源码备份与失败日志保存在 `.cache/dialog-focus-2026-10-17/`。

`showModal()` 自动将焦点给第一个关闭按钮，非聚焦开启时该按钮立即匹配 `:focus-visible`，形成默认橙色框。`Dialog.tsx` 仅在打开后焦点实际位于自带关闭按钮时，将其移到 `tabIndex=-1` 的标题；已聚焦的表单控件不接管，无标题详情弹窗不受此分支影响。`styles.css` 只取消标题自身的轮廓，按钮的全局键盘焦点及既有悬停样式保留。

## 已执行验证

| 对象 | 命令或操作 | 结果与证据范围 |
| --- | --- | --- |
| 修前失败 | `npm run test:web -- tests/web/agent-flow.spec.ts --grep 'dialog close is quiet' --workers=2` | 浅、深两例均在初始 outline 为 `solid` 而非 `none` 处失败；`browser-before.log` 和 `browser-before/` 保留原件 |
| 浏览器最终回归 | `npm run test:web -- --workers=4` | 112 通过；新用例覆盖非聚焦开启、悬停、移开、Tab、Escape返回及添加方式切到创建表单后的自动聚焦；既有嵌套、删除发起控件、扩展管理及此前三项修复继续通过 |
| 实际浏览器渲染 | Chrome，1180px/375px，浅、深主题 | 桌面初始透明无框、悬停背景变化、Tab关闭按钮有轮廓；窄屏初始无框且无横向溢出。`browser/states.json` 与对应截图 |
| Mac 普通包 | `npm run release:mac -- --stage`；独立数据启动候选；原生指针、Tab、Escape和关闭按钮 | 构建及临时签名通过；两主题初始焦点为标题、Tab为关闭按钮，Escape及点击关闭返回添加按钮，添加方式切到创建表单后名称输入获焦。`mac/result.json`、`*-default.png`、`*-keyboard.png` 与 AX记录 |
| Android 普通包 | 通过既有工具链执行 `npm run android:build`；安装到隔离 API36 ARM64 模拟器 | 构建、v2签名通过；ADB触控/Tab/Escape操作，WebView CDP观察。两主题初始 outline `none`、Tab `solid`、关闭目标44×44 CSS px、表单聚焦与返回通过，无横向溢出。`android/result.json`、对应截图、签名和包信息 |
| 独立审查 | 对修前备份与本次代码/用例增量、最终回归和两端实际截图只读审查 | 独立验收通过，无剩余阻断缺陷；核对标题不进入Tab顺序、表单/bare分支和返回焦点未被扩大修改 |

原生与浏览器材料均在 `.cache/dialog-focus-2026-10-17/`，不提交原始日志和截图。悬停由 Chrome 实际 hover 和计算样式确认；Mac另用原生次级点击后 Escape 取消菜单观察指针位置反馈，材料为 `mac/light-hover-native.png`，单纯合成移动的截图不计为悬停成功证据。Android范围为 Android 16/API36 ARM64 模拟器、WebView 133.0.6943.137，不含真机或其他配置。

## 本地交付

两端同源受验原目录已移入 `release/mac` 与 `release/android`，没有重新构建。版本均为0.0.4 debug，Mac为arm64临时签名，Android为ARM64 debug签名。`build-info.json`记录来源与交付校验，`source.patch`在两端一致，`acceptance.json`链接本期范围。

旧完整目录分别保留在 `.cache/archive/releases/mac-MDTbJM/mac` 与 `.cache/archive/releases/android-7c8uJL/android`，含原包、说明、build-info与source.patch；此前旧包继续保留。移动回执及清单为 `.cache/dialog-focus-2026-10-17/publish-result.json` 和 `delivery-inventory.json`。恢复二进制时先关闭对应实例，在隔离数据下恢复；不据此回滚应用数据。

交付后实际 `release/mac/Plums M1.app` 入口在隔离数据下冷启动正常，已有Agent和品牌占位恢复，验收实例已关闭；`mac/delivered-result.json`与窗口截图留证。Android同一APK冷进程重启后重新打开添加弹窗，初始outline仍为`none`，点击关闭焦点返回；`android/cold-result.json`留证。旧窗口需退出后从当前Mac入口重新打开才能使用新构建。

本次未修改 Rust、权限、存储和原生适配；其历史专项结果按未变输入复用，没有把此前274项单元结果写成本次重跑。网络/凭据、真机、iOS、Windows/Linux、完整辅助技术和正式分发继续保持待验，M2整体未退出。
