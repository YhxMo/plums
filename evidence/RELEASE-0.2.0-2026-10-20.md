# 0.2.0 交付（2026-10-20）

状态：两端候选经实际运行与四轮独立审查后发布；结果只证明下列提交与平台。

## 来源

受验提交 `6668ce72799092e1a7de87e0c9219fafeb1511c5`，两端 `source.patch` 均为空。相对上一交付（`015ac2d`，0.0.4）的主要增量：应用内填写 API Key（Mac 存数据根 `credential-secrets.json`，不用钥匙串）、整段对话发送与提示缓存、`network.read` 公开读取能力、获取模型列表时按 models.dev 为每个模型填上下文窗口，以及版本号 0.2.0。

原始 AX 导出、截图、日志与验收脚本保存在本地 `.cache/release-0.2.0/`，不提交。 历史提交标识与当前源码的对应关系见[开发流程](../docs/DEVELOPMENT.md#历史提交与交付来源)。

## 自动化与构建

| 项目 | 结果 |
| --- | --- |
| Web | `npm run verify:web` 通过：804 单元，类型、构建、格式、边界、行数与 lint |
| 浏览器 | `npm run verify:e2e` 148 项通过 |
| Rust | `npm run verify:native` 通过：格式、Clippy、64 单元 |
| Mac 候选 | `npm run release:mac -- --stage`；arm64 0.2.0 debug、ad-hoc 签名，`codesign --verify --deep --strict` 通过 |
| Android 候选 | `PLUMS_ANDROID_TOOLS_ROOT=<工具链> npm run android:build`，ARM64 debug，versionCode 2000 / versionName 0.2.0，构建无警告；SHA-256 `34102c21092ddee81a76ec491c1f9b5439b5c978de3b7baa17490ce21353ac5f`，145215879 字节 |

Gradle 调试包增量打包会在复用的 APK 中留下空洞（一次得到 283 MB、内容与 145 MB 包相同），因此候选从清空的输出目录重新打包。

## 实际运行

| 平台 | 观察结果 |
| --- | --- |
| Mac 打包应用（隔离数据目录，AX 驱动） | 欢迎页；关于显示「Plums · 0.2.0」；扩展管理中模型连接运行中，说明为「密钥只交给本机应用保存」，权限含「读取公开网络资源（models.dev，不带密钥）」，无旧的「系统凭据库/原生面板」文字；添加服务商表单默认窗口 128K 与 models.dev 提示；手动添加模型并选 1M 窗口后保存：密钥只出现在 `credential-secrets.json`（权限 0600），扩展记录 v6 含 `windows: {模型: 1000000}`；重启后列表仍显示「上下文 1M」 |
| Android（API36 ARM64 模拟器，全新 AVD，WebView 133.0.6943.137） | 欢迎、关于 0.2.0、连接器运行中与新文案；原生 `network_read` 真实读取 `https://models.dev/api.json`：200、5855391 字节、231 个服务、DeepSeek 地址正确；未授权 owner 为 `denied`、http 与 IP 地址为 `invalid-request`，均 `not-dispatched`；启动后立即取消得到 `cancelled`/`unknown`，随后下一次读取 200；服务商表单默认窗口 128K，无横向溢出 |

保存服务商只写本地文件，Mac 运行未发出模型或 models.dev 请求。

## 独立审查

对 `82714a1..2241f9e`、`2241f9e..4caadb1`、`4caadb1..741bf25` 与 `741bf25..6668ce7` 分别做独立代码审查，最后一轮无发现。采纳并修复：模型列表等待 models.dev 最多 5 秒且读取不随单个调用取消；窗口标签精确显示（不再把 131072 与 128000 都写成 128K，小的回复预算不再显示 0K）；最大输出错误指出具体模型；Android 取消在连接后再检查；窗口测试拆分以符合行数上限；Android 构建接受先前网络插件模板。第二轮建议「连接后才算已发出」与契约「`not-dispatched` 仅指未开始网络 I/O」冲突，第三轮指出后已恢复。未采纳并说明：Rust 层再次核对声明来源（信任边界已在 [NETWORK-READ](../docs/NETWORK-READ.md) 说明）、目录常驻内存与后台读取（有上限并缓存 1 小时）、关闭表单不取消获取（既有行为，结果被丢弃）、测试依赖完整 Git 历史（沿用凭据插件的既有做法）。

## 未验范围与偏差

- 未用真实密钥调用模型服务；Mac 打包应用未读取 models.dev（获取列表需要密钥），该路径只在 Android 原生层与单元/浏览器测试中验证。
- 在已废弃的 `2241f9e` 候选验收中，曾把明显无效的占位 Key 填入 OpenRouter 表单并获取模型列表（Mac 列表 470 个模型、456 个填入窗口）。这违反了"不向第三方发送假密钥"的约定，之后的验收未再这样做。
- Android Keystore 写入、真机、中文 IME、其他平台与正式签名分发未验。
