# 非敏感扩展配置（实验）

Manifest 可选声明 `configuration: { version: 1, fields: { step: { type: "number", label: "每次增加量", default: 1, min: 1, max: 100 } } }`。version 是正整数且精确匹配；本阶段支持 string（必填 maxLength，1–4000）、有限 number（必填 min/max）和 boolean，所有字段必须有类型正确且满足边界的 default。字段名限定小写字母开头的字母/数字/下划线。未知类型和非法声明拒绝加载。

持久化值为 `{ version, values }`，values 必须包含全部声明字段且不能增加未知字段，不做隐式类型转换或迁移。未保存时使用默认值。普通配置不是秘密存储：禁止放入密钥、令牌或其他凭据；没有 secret 字段类型、加密或授权能力。敏感凭据仍等待独立契约。

扩展在 activate 中读取 `ctx.configuration`，得到冻结的平面值快照，不同扩展互相隔离。样板 counter 的 step 控制每次增加量，panel 的 title/showCount 控制界面。样板版本为 1.1.0，服务协议继续为 1；旧组合精确版本不匹配会按现有规则提示，须明确重新保存组合，不能冒充兼容迁移。

宿主管理接口：`host.install(definition, savedConfiguration?)`；`host.configuration(id)` 查询 `{ value, error? }`。坏的持久化值保留在外壳，Host 报 configuration error 并阻止激活，不悄悄以默认值运行。查询值在错误时为默认值，仅供编辑器显式修复；取消不替换原配置。`await host.configure(id, value)` 仅接受成功停用且 desired=false 的记录，校验成功后更换下一次激活快照。

外壳配置编辑器调用校验 → stop → 持久化确认 → configure → 按操作前启用意图 start。配置表存于 `host.shell.value.configurations`，以扩展 ID 为键，与组合集合分开；卸载保留配置，同 ID 重装按新声明重新校验。声明普通配置不增加任何平台能力，已有权限确认流程不变。

取消/校验失败不停用、不写入；清理失败不保存；写入失败保留旧配置，扩展可能已经停用；未知回执沿用应用写锁，必须重载确认。保存成功后激活失败可能已经保存新值，界面明确显示操作未完成，不能当作事务回滚。失败后再次保存时按当前停用状态处理，需显式启用。原配置不兼容时默认值只作为编辑建议，明确保存会替换旧值，没有自动升级或后台迁移。

独立作者仅依赖 `modules/sdk` 的类型与公开 Host 管理方法；不应读取 Host 内部状态。通用配置字段不包含业务协议、远程地址访问能力或文件授权。完整嵌套 schema、枚举、凭据、动态热更新和迁移不在本阶段范围。

声明移除属于未支持的迁移：新版不再声明 configuration 而旧保存值仍存在时，Host 阻止激活，外壳没有配置编辑入口；卸载重装也保留旧值，须由后续迁移工具或外部受控修复处理。不能把当前编辑器描述为所有坏配置的通用恢复器。
