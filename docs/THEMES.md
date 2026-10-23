# 实验主题颜色贡献

[SDK](../modules/sdk/index.ts) · [作者入口](SDK-AUTHORING.md) · [UI](UI.md)

状态：当前有效（2026-10-24 核实）；实验主题契约，尚未稳定，不是安全沙箱。

主题只提供 Web 内容的语义颜色，不注入 CSS、字体、布局或脚本；共享 WebView 的可信扩展仍可自行改 DOM，因此该校验不是安全沙箱。原生窗口/系统栏仅跟随明暗模式，颜色仍使用原生内置值。

扩展在 activate(ctx) 中调用 `ctx.theme({ id, label, appearance, colors })`。`id` 遵循扩展 ID 格式（小写字母开头，最多64字符，仅小写字母、数字、点、连字符，无连续点），不能为内置 `light` / `dark`；`label` 为1–80字符非空白显示名；`appearance` 为 `light` 或 `dark`。`colors` 必须完整提供下表17个键，可另加第二张表的布局色，不能有其他字段。除 shadow 外只接受 `#RRGGBB`，shadow 接受 `#RRGGBB` 或 `#RRGGBBAA`；可使用大小写。样板不需要平台权限或服务声明。

| 键 | 用途 |
| --- | --- |
| text / muted | 正文 / 次文字 |
| background / surface / card / overlay / subtle | 页面、表面、卡片、弹窗、弱表面 |
| border / control-border | 分隔线 / 输入边框 |
| accent / accent-hover / accent-ink | 主按钮、悬停、主按钮文字与焦点 |
| accent-soft / accent-text | 弱强调底 / 强调文字 |
| error / running / shadow | 错误文字、运行状态、阴影 |

布局色决定默认界面的窗口底色、会话卡片、气泡、列表三档与窄栏图标，均可省略；省略的键由外壳按下表从必填色推导，提供的键原样使用。

| 键 | 用途 | 内置浅 / 深 | 省略时 |
| --- | --- | --- | --- |
| chrome | 窄栏与 Agent 列表共用的窗口底色，也是列表普通行 | `#EEEEF0` / `#2F2F30` | text 混入 background 7% |
| chat | 浮起的会话卡片与其他工作区卡片 | `#FFFFFF` / `#1E1E1F` | background |
| bubble | 对方消息气泡 | `#F2F2F3` / `#2C2C2F` | subtle |
| row-pinned | 未选中的置顶行 | `#E6E6E8` / `#3B3B3D` | text 混入 background 12% |
| selection / selection-text | 选中行与窄栏当前项 / 选中行文字 | `#E8692F` / `#FFFFFF` | accent / accent-ink |
| rail-icon | 窄栏未选中图标 | `#5A5A5F` / `#B0B0B5` | muted |

自己的消息气泡沿用 accent 与 accent-ink。内置配色中选中行白字对橙底约 3.2:1，低于 WCAG AA 的 4.5:1，是与微信绿底白字同类的取舍；推导值使用 accent-ink，对比由作者负责。

默认界面的 shadcn/ui 组件不另设颜色：[src/app.css](../src/app.css) 把这些键映射为组件所用的 Tailwind 颜色（如 accent→primary、overlay→popover、subtle→muted），shadow 用于三级阴影，因此贡献的主题同样作用于按钮、菜单、弹窗和提示。

同一 ID 重复注册立即抛错，不覆盖先到者；重名 label 允许，选择器同时显示 ID。颜色完整性和格式会校验，审美及对比不由 Host 保证；作者必须核对真实文本、按钮、焦点及不同表面。颜色对象在注册时复制，宿主查询也返回副本，修改原对象或查询结果不更改登记值。合法不同 ID 之间由用户显式选择，不隐式争夺优先级。

`Host.themes()` 返回当前 active 且作用域仍开放的贡献，字段为上述主题加 `owner` 与 `generation`。激活尚未结束、失败、停用或清理失败的贡献不可用；Scope 负责移除登记。停用的旧 ctx 不能重新注册。当前仅支持随扩展生命周期的静态贡献；修改颜色应停止并重新启动扩展。主题可随非聊天 UI 同用，不依赖视图挂载。

应用设置列出可用主题，写入偏好成功后再应用颜色。选择扩展主题时保留用户最近选择的内置明暗外观作为后备。选定主题不可用即清除扩展变量并恢复内置外观，显示原因；保存的 ID 保留，因此同 ID 再次可用时恢复。应用设置里的明暗切换及“使用内置外观”清除扩展偏好。偏好 ID 不会自动安装、启动或授权扩展；重启后的启用集合由自动记录的组合快照恢复。未知结果的配置保存沿用现有锁定规则。

两个开发样板（海湾省略布局色、墨夜全部提供）及应用设置路径见[作者入口](SDK-AUTHORING.md#公开主题样板)。任意样式、快捷键和完整辅助技术不属于当前颜色契约。
