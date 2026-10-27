# 当前验证与交付

结果绑定各自的源码与平台；开发候选的实际状态见 [HANDOFF](../HANDOFF.md)，剩余验收见[当前阶段](../docs/spec/milestone.md)。

## 当前交付

| 平台 | 版本与证据 | 入口与受验范围 |
| --- | --- | --- |
| Mac arm64 | 0.3.0，[交付证据](RELEASE-0.3.0-2026-10-27.md)，源码 `9d2327d` | `release/mac/Plums.app`，release ad-hoc；第 1 级退出交付：最终候选上的真实回复、所有者对卡片页与输入法的报告，以及更早候选上的迁移、记忆与抽查记录 |
| Android ARM64 | 0.2.0（冻结），[交付证据](RELEASE-0.2.0-2026-10-20.md)，源码 `40a7382`（包内记录为改写前的 `6668ce7`，标签 `v0.2.0`） | `release/android/plums-0.2.0-android-arm64-debug.apk`；API36 模拟器上的原生 models.dev 读取、拒绝与取消、连接器和表单 |

结果只证明所列提交与平台，不证明之后的源码。被替换的 Mac 0.2.0 存档于 `.cache/archive/releases/mac-VIqa8V/mac`；现行恢复入口见 [HANDOFF](../HANDOFF.md#当前交付与恢复)。

## 其他记录

- [作者检验：只凭公开文档写凭据连接器（2026-10-26）](CONNECTOR-AUTHOR-2026-10-26.md)：AI 作者的文档检验与交付物，文档缺口的处理。
