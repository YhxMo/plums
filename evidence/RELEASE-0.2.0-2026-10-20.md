# 0.2.0 交付（2026-10-20）

状态：当前交付证据；两端候选经实际运行与独立审查后发布，结果只证明下列提交与平台。

## 来源

受验提交 `40a738292eafc9d3c0cac5695d05f38cfa376621`，两端 `source.patch` 均为空。相对上一交付（`b458b3e`，0.0.4）的主要增量：应用内填写 API Key（Mac 存数据根 `credential-secrets.json`，不用钥匙串）、整段对话发送与提示缓存、`network.read` 公开读取能力、获取模型列表时按 models.dev 为每个模型填上下文窗口，以及版本号 0.2.0。

包旁的 `build-info.json`、`source.patch` 与校验清单用于恢复与来源核对；原始运行资料不进入源码。

## 自动化与构建

| 项目 | 结果 |
| --- | --- |
| Web | `npm run verify:web` 通过：804 单元，类型、构建、格式、边界、行数与 lint |
| 浏览器 | `npm run verify:e2e` 148 项通过 |
| Rust | `npm run verify:native` 通过：格式、Clippy、64 单元 |
| Mac 候选 | `npm run release:mac -- --stage`；arm64 0.2.0 debug、ad-hoc 签名，`codesign --verify --deep --strict` 通过 |
| Android 候选 | `PLUMS_ANDROID_TOOLS_ROOT=<工具链> npm run android:build`，ARM64 debug，versionCode 2000 / versionName 0.2.0，构建无警告；SHA-256 `34102c21092ddee81a76ec491c1f9b5439b5c978de3b7baa17490ce21353ac5f`，145215879 字节 |

## 实际运行

| 平台 | 观察结果 |
| --- | --- |
| Mac 打包应用（隔离数据目录，AX 驱动） | 欢迎页；关于显示「Plums · 0.2.0」；扩展管理中模型连接运行中，说明为「密钥只交给本机应用保存」，权限含「读取公开网络资源（models.dev，不带密钥）」，无旧的「系统凭据库/原生面板」文字；添加服务商表单默认窗口 128K 与 models.dev 提示；手动添加模型并选 1M 窗口后保存：密钥只出现在 `credential-secrets.json`（权限 0600），扩展记录 v6 含 `windows: {模型: 1000000}`；重启后列表仍显示「上下文 1M」 |
| Android（API36 ARM64 模拟器，全新 AVD，WebView 133.0.6943.137） | 欢迎、关于 0.2.0、连接器运行中与新文案；原生 `network_read` 真实读取 `https://models.dev/api.json`：200、5855391 字节、231 个服务、DeepSeek 地址正确；未授权 owner 为 `denied`、http 与 IP 地址为 `invalid-request`，均 `not-dispatched`；启动后立即取消得到 `cancelled`/`unknown`，随后下一次读取 200；服务商表单默认窗口 128K，无横向溢出 |

保存服务商只写本地文件，Mac 运行未发出模型或 models.dev 请求。

## 未验范围

- 未用真实密钥调用模型服务；Mac 打包应用未读取 models.dev（获取列表需要密钥），该路径只在 Android 原生层与单元/浏览器测试中验证。
- Android Keystore 写入、真机、中文 IME、其他平台与正式签名分发未验。
