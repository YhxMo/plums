# M1 设置项声明与校验：已实现行为

更新于 2026-10-03。原任务已通过 M1 PR 实现；本文描述源码现状，后续开发以公开 API 和现有契约测试为准。

## 清单格式

`settingsSchema` 必须为 object，带 `type: "object"` 和 `properties`。每项必填 `type`、`title`、`description`；类型为 string/number/integer/boolean。必填设置由 schema 的 `required` 数组指定。

非密钥项支持可选 default、minimum、maximum、enum。default 必须通过类型和约束校验；minimum/maximum 只能用于 number/integer。不合法清单返回 `MANIFEST_INVALID`，path 指向 `/settingsSchema/properties/<key>/<字段>`，key 使用 JSON Pointer 转义。

`x-secret: true` 项仅允许 type/title/description/x-secret 四个键；default、enum、嵌套及其他键均拒绝。密钥值写入 SecretStore，settings 保存该字段的 secretRef。

## setSettings

公开方法为 `setSettings`。写文件前依次检查 required 和类型、回填 default、检查 minimum/maximum/enum。required 先于 default：默认值不会补过缺失必填项。

普通字段错误为 `SETTINGS_INVALID`，path `/settings/<key>`，details 带 key 与 reason，不带输入值；失败不改设置文件。密钥引用验证维持 `SECRET_NOT_FOUND`。未知设置键保留；没有 settingsSchema 的包沿用既有设置行为。

## 导入与更新的残留 settings

在写包目录或安装记录前检查残留文件。

| 情形 | importPackage | updatePackage |
| --- | --- | --- |
| 有 schema，缺必填、类型错误、范围或 enum 不符 | `IMPORT_INVALID`，具体字段 path | 同左，保留旧包 |
| 有 schema，非法 JSON 或不是 JSON 对象 | `IMPORT_INVALID`，`/settings`，reason `NOT_JSON` | 同左，保留旧包 |
| 无 schema，但存在残留文件 | 拒绝，`/settings`，reason `NO_SCHEMA`；不读取或自动删除该文件 | 忽略文件 |
| 无残留文件 | 正常继续 | 正常继续 |

有 schema 时使用同一校验函数。它会检查回填后的默认值，但残留校验本身不写 settings 文件。请勿按旧任务文本把所有无 schema 情形都改成失败或自动清理。

## 已另行安排与延后项

- 正常更新删除移除字段的密钥已有实现；清理失败与重启后清理由已合并 #28 增补，使用 schema 3 保存历史引用。参见 HANDOFF_M1.md 的历史兼容性说明；当前数据库格式已升为 4。
- `PACKAGE_FORMAT_VERSION` 已公开导出，export 已保存传入的 formatVersion。常量收口见 `task-package-format-version.md`；高 major 使用现有 `FORMAT_UNSUPPORTED`，不引入旧任务建议的另一错误契约。
- `describeSettings`、参考表单渲染器、文件路径等新增类型留到 M2；它们目前不存在。路线图中的 `setSetting` 是设计提案，不能当作现有方法调用。
- C1 已由 #26 与 #24 收口；独立公开校验/inspect API、insert-only 安装记录和残留设置的导入/更新差别保持。
