# 当前验证与交付

本页维护当前交付与必要的证据入口。结果绑定各自源码、命令和平台；历史记录从 [历史验收索引](HISTORY.md) 查阅。

## 当前交付

[2026-10-18 M2.0 重新基线](BASELINE-2026-10-18.md)记录当前两端交付：标签 `m2-baseline-2026-10-18`（015ac2d）、空 source.patch；普通候选实际运行并经独立复核后原包发布。

| 平台 | 当前入口与范围 |
| --- | --- |
| Mac arm64 | `release/mac/Plums M1.app`，0.0.4 debug ad-hoc；主题双向与冷恢复、管理、Agent 恢复、真实拒写反馈、原生凭据取消 |
| Android ARM64 | `release/android/plums-m1-0.0.4-android-arm64-debug.apk`；API36 ARM64 模拟器，主题恢复、显式管理返回、IME/Back 收键盘、Agent 恢复、凭据取消 |

已知限制：此基线交付包的管理页系统 Back 退出 Activity；[P7](ENGINEERING-PREREQUISITES-2026-10-18.md#p7android-返回层级)已在开发普通候选修复并验收，尚未替换 release。真机、中文 IME 组合输入、其他平台和真实模型调用不在本次范围。旧两端包分别保留在 `.cache/archive/releases/mac-Eyjl1K/mac`、`.cache/archive/releases/android-TcFWvt/android`。此前[弹窗焦点交付](DIALOG-FOCUS-2026-10-17.md)仅证明其受验版本，不能代表当前包全范围验收。

## 当前本地增量

[工程前置 P6/P1/P7/P2](ENGINEERING-PREREQUISITES-2026-10-18.md)：P6 允许名单与 P1 业务所有权已通过反例、回归及独立审查；P7 最终 Android 普通候选已验证 IME、菜单/嵌套弹窗、管理与工作区返回、草稿和焦点。P2 同源 IPC 与稳定错误码已通过独立审查。最终 584 单元、129 浏览器、Rust 默认 33/实验 39 单元及普通 Android IPC/返回路径通过；333 文件源码清单及首次失败记录见该证据，release 不变。

[M2.3.1 TLS/JNI 可行性](TLS-JNI-FEASIBILITY-2026-10-18.md)：独立 Mac/Android 候选各通过 TLS 五项，Android JNI 六项通过；正式 companion 的首次反例、官方测试信任库的限定范围和 OS 辅助联网门槛见该记录。默认应用与 release 未变。

## 历史与验收范围

已纳入交付的工程维护与平台增量按 [历史索引](HISTORY.md) 查阅；A/B/C1–C4 的完整命令、失败反例、审查和视觉对照保存在 [工程维护记录](MAINTENANCE-2026-10-17.md)，不再作为当前实现状态重复展示。

当前验收目标见 [ACCEPTANCE](../docs/ACCEPTANCE.md)，M2 未完成项见 [退出清单](../docs/spec/M2-EXIT-CHECKLIST.md)。各记录只证明其受验版本及平台；Android 真机、iOS、Windows/Linux、完整辅助技术和正式签名分发尚未因此通过。
