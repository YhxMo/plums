# 当前验证与交付

结果绑定各自的源码与平台；开发候选的实际状态见 [HANDOFF](../HANDOFF.md)，剩余验收见[当前阶段](../docs/spec/milestone.md)。

## 当前交付

[0.2.0 交付证据](RELEASE-0.2.0-2026-10-20.md)：源码 `6668ce7`，两端 `source.patch` 为空。包旁的构建信息与校验清单保留。

| 平台 | 入口与受验范围 |
| --- | --- |
| Mac arm64 | `release/mac/Plums.app`，debug ad-hoc；关于、连接器、服务商表单、模型窗口保存与重启恢复 |
| Android ARM64 | `release/android/plums-0.2.0-android-arm64-debug.apk`；API36 模拟器上的原生 models.dev 读取、拒绝与取消、连接器和表单 |

两端结果不证明当前未提交源码。真实模型调用、Mac 交付包读取 models.dev、Android Keystore 写入、真机、中文 IME 与其他平台不在该交付的受验范围。现行恢复入口见 [HANDOFF](../HANDOFF.md#当前交付与恢复)。

## 开发候选记录

- [Mac 打包抽查（2026-10-25）](MAC-SPOTCHECK-2026-10-25.md)：`78c072b` 的隔离候选，对话体验与窗口框架的所有者抽查；不是交付。
- [Mac 打包检查点（2026-10-24）](MAC-CHECKPOINT-2026-10-24.md)：`eb5c68b` 的隔离候选，在真实改名前数据副本上的迁移与一次真实模型调用；不是交付。
- [Mac 输入法、焦点与管理页布局（2026-10-23）](MAC-INPUT-LAYOUT-2026-10-23.md)：改名前构建的隔离包；不是交付。
