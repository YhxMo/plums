# Plums 角色卡：当前信封格式与后续适配草稿

更新于 2026-10-03。角色卡是 `kind: "character"` 的 ZIP 包，包含 manifest.json 和其他文件。M1 只校验通用信封，不校验人设或执行角色逻辑。下面的 payload 组织方式是内容示例，尚不是单独批准的角色内容标准。

## 可被当前内核接受的清单示例

```json
{
  "formatVersion": "1.0",
  "kind": "character",
  "id": "my-assistant",
  "name": "每日助理",
  "version": "0.3.0",
  "description": "整理每日事项的角色示例",
  "license": "CC-BY-4.0",
  "author": "someone",
  "dependencies": [],
  "permissions": [],
  "payload": {
    "persona": { "instructions": "帮助用户整理每日事项。" },
    "roleplay": { "personality": "", "scenario": "", "greeting": "" },
    "extensions": {}
  }
}
```

formatVersion、kind、id、name、version、description、dependencies、permissions、payload 九项必填；依赖和权限为空时也须提供数组。license、author 可选。signature 可保留，M1 不签名或验签。

id 最长 64 字符，规则为 `^[a-z0-9]+([._-][a-z0-9]+)*$`；允许单字符 id，不允许连续分隔符或尾部分隔符。version 是 SemVer 内容版本，formatVersion 是 major.minor 信封版本。

payload 原样保存，内核不要求 persona.instructions，也不解释 roleplay 或 extensions。未知字段允许保留；导出仍受既有密钥脱敏规则约束。

## 权限与依赖

人设文本不会授予权限。权限必须在 permissions 中声明，并经过同意与运行时检查；需要确认的动作通过宿主 Confirm。

inspect 返回该包自己的权限与依赖，不汇总依赖权限。必需依赖缺失或版本不匹配时启用返回 `DEPENDENCY_MISSING`，path `/dependencies/<index>`。内核不自动下载依赖，也没有执行角色 agent 的内置循环。

## 当前版本行为

内核接受 `1.x` 并保留同 major 的未知字段；更高 major 返回 `FORMAT_UNSUPPORTED`、`/formatVersion`。导出使用传入清单的 formatVersion，不总是改写成最新版本。M1 没有 major 格式迁移器，不能承诺所有旧 major 都可迁移。常量收口见 `task-package-format-version.md`。

## V2/V3、PNG 与 Skills：M2 待设计

当前内核没有角色卡 JSON/PNG 的 chara/ccv3 适配器或 Skills 导入器。开工前单独明确字段映射、来源格式记录、id 生成、未知字段保留及损失边界。

拟议映射可将 system_prompt/description、personality/scenario、first_mes/alternate_greetings、mes_example、post_history_instructions、character_book 组织到角色 payload，并在私有扩展命名空间保留往返所需的来源信息。是否合并文本、如何拆回以及默认导出版本仍需在适配器任务中确定。

外部卡默认没有内核权限；即便发现 extensions.plums，也必须验证其内容并走正常同意流程，不能据此获得授权。任意第三方卡的无损往返尚未证明，不能作为已有保证。测试应使用自造夹具，真实角色卡保留在本地。
