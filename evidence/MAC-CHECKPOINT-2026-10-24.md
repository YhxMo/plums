# Mac 打包检查点（2026-10-24）

状态：开发候选验收记录；结果只证明下列源码与平台，不是交付。

## 来源

源码 `eb5c68b`（`feat/ui-refresh`），`npm run release:mac -- --stage` 构建，`source.patch` 为空。候选 `release/.mac-MxLDoZ/Plums.app`：`dev.plums.plums` 0.2.0 arm64 debug、ad-hoc，`codesign --verify --deep --strict` 通过。`release/mac/` 未替换。

## 自动化

| 范围 | 实际结果 |
| --- | --- |
| Web | 同一提交上 `npm run verify:web` 通过：936 单元，以及类型、构建、发布配置、格式、边界、行数与 lint |
| Chromium / WebKit / 原生 | 本检查点未重跑，沿用 HANDOFF 记录 |

## 打包应用实测

平台：macOS 27.0.1（26A434）arm64。直接启动包内可执行文件，`HOME` 指向临时目录、不设 `PLUMS_DATA_DIR`，数据目录为该临时目录下的正式路径。迁移源是所有者真实改名前数据（`dev.plums.m1/m1-experiment`，2 个 Agent、5 个会话、3 个 version 3 消息页共 25 条消息、凭据绑定与密钥文件）的副本；原目录未参与。

- **旧数据迁移**：首次启动把旧目录整体复制到 `dev.plums.plums/data` 并写入 `migrated-from.json`；副本中的旧目录前后 SHA-1 一致。各所属者的旧 JSON 在首次打开时导入版本 2 的 SQLite 库，原文件移入 `legacy-json/`。
- **消息转为记录**：所有者在打包应用中看到 2 个 Agent 及其旧会话；发送一条消息后，消息页文档被删除，记录为 27 条（旧 25 条 + 新 2 条），按会话分为 13 / 8 / 6 条，旧消息在前；退出重启后消息仍在。
- **真实模型调用**：所有者获授权后在“代码助手”中向 DeepSeek（`api.deepseek.com`，`deepseek-flash`）发送“用一句话回答：1+1 等于几？”，约 1.2 秒收到“1+1 等于 2。”，只调用一次。约定的输出上限 64 **未生效**：连接的 `maxTokens` 仍为空，按服务默认值发送。密钥来自迁移后的 `credential-secrets.json`。
- **扩展包导入**：所有者用“选择文件夹”和拖入文件夹两种方式导入样板 `theme-ink`，均出现安装预览。
- **模型连接**：所有者带密钥获取 DeepSeek 模型列表，上下文窗口自动填写（`network.read` 读取 models.dev）。
- **密钥**：迁移后的 SQLite 库与 `legacy-json/` 中未找到 `sk-` 形式的密钥；应用标准输出为空。

## 未验

- 已有版本 1 库原地升级到版本 2：本机没有版本 1 的库（已交付的 0.2.0 使用 JSON，SQLite 第一步的调试数据已不存在），用户只会走 JSON 导入；仍只有单元验证。
- 复制失败弹窗、写入中途崩溃的一致性。
- 带输出上限的真实调用、长上下文、图片和思考强度；统一日志中无密钥。
- 窗口与界面抽查（窗口按钮、焦点环、明暗、启动耗时）；会话内文档选择。

测试结束后删除了临时 HOME（含密钥副本）。
