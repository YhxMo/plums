# 通用绑定与原生凭据管理限定验证

日期：2026-10-17（Asia/Shanghai）。负责人：SDK/平台维护者；独立审查者未参与实现。范围为通用连接声明、非秘密绑定状态、原生安全输入与凭据适配代码，以及代理配置和取消/恢复入口。

## 源码与实现

基线为 `9c05356de46409d199a35f4eeff2831a23c8bba9`。工作区差异、未跟踪源码清单及原文件保存在 `.cache/credential-native-2026-10-17/source/`。最终证据措辞与工程状态的四份文档修订另存于同材料根的 `documentation-final/`，原受验快照保留。Mac 测试包使用受验源码和 `mac.config.json`：仅隔离应用标识、产品名、窗口标题，并跳过已执行的前端构建；Android 使用普通 debug 配置。最终 Android 密码遮罩修正仅涉及 Kotlin 模板，未改变 Mac 编译输入或前端。

实现与用法见[绑定与原生录入](../docs/CREDENTIAL-BINDINGS.md)。可选 `manifest.credentialBindings` 声明不包含秘密；Host 和原生分别校验。元数据按 owner/alias、来源/版本、政策、路由及修订保存；pending/ready/disabled/delete-pending 回执不混写。未知写入须核对，取消保留旧绑定，删除先禁用，移除声明和卸载后保留清理入口。

Mac 使用原生安全输入和 Keychain；Android 使用原生密码框、Keystore AES-GCM 密钥与 noBackup 密文。WebView 命令和响应不包含原始密钥。代理配置支持显式 HTTP(S) 端点，默认 direct，不自动读取系统/环境代理；官方 API 目标保持。生产 `credential.request` 仍不可用，传输与请求授权未接通。

## 已执行检查

材料根目录为 `.cache/credential-native-2026-10-17/`，原始日志、截图、测试数据和候选包不提交。

| 检查 | 结果与范围 |
| --- | --- |
| 实现前反例 | `npm test -- tests/credential-bindings.test.ts` 因缺少声明校验模块失败；before.log |
| 全单元 | `npm test`：39 文件、329 项通过；unit-final.log |
| Rust 单元 | `npm run native:test`：27 项通过；native-unit-final.log；没有系统秘密操作 |
| 浏览器全回归 | `npm run test:web -- --workers=4`：117 项通过；browser-final.log，包含此前已确认 UI 及新增 5 项凭据管理用例 |
| 类型与构建 | `npm run build` 通过；build-final.log；最终 Android 构建亦重新执行前端构建 |
| Rust 静态检查 | `npm run native:check` 通过；clippy-final.log |
| Rust 格式 | 既有 nightly 的 `rustfmt --edition 2021 --config skip_children=true --check` 检查三个受影响 Rust 文件通过；rustfmt.log；默认 stable 未安装 cargo-fmt |
| Android 模板 | 最终 Kotlin 修正后，`npm test -- tests/android-project.test.ts` 的 12 项通过；android-generation-final.log |
| 格式、文档与公开源码检查 | format-final.log、project-final-3.log、whitespace.log；最终文档修订后补查 project-final-docs.log 与 whitespace-final-docs.log；三份名为 credentials 的公开源码明确列入文件名检查例外，凭据值、私人路径与其他敏感文件名检查保留 |
| 源码独立审查 | 发现并修复 disabled 清理不可达、临时文件阻塞恢复、声明/卸载遗留记录隐藏、pending 缺引用 panic、认证枚举类型转换等反例；定点源码复核未发现剩余 P1/P2 |

绑定单元覆盖非法字段/头/目标/认证/代理、过期修订、并发管理、取消与拒绝、未知保存/删除、坏元数据、提交失败后重启和部分创建恢复。浏览器用例覆盖浅/深主题、375px/1180px、删除声明及卸载后清理入口、未知保存恢复、原生命令仅携带非秘密元数据与取消焦点返回。

## Mac 原生测试包

`mac/Plums Credentials Test.app` 为隔离配置的 arm64 debug 测试包，本地临时签名；构建入口为 `npm run native -- build --debug --bundles app --config <测试配置>`，mac-build-final.log。数据放在材料目录的 mac/data，未使用既有应用资料。

通过原生指针与键盘实际打开安全输入面板：浅/深主题的安全输入框初始获焦；点击取消、Escape 关闭后返回录入按钮，绑定记录为空。证据为 mac/key-cancel-result.json、final-dark-key.txt/png、final-light-key.txt/png 及 native-flow.json。

代理设置使用**仅非秘密元数据**夹具，没有创建 Keychain 项。原生面板保存 `http://127.0.0.1:7890`，再清空切回直连，重读磁盘记录与界面一致，官方目标未变；撤销面板取消保留记录并返回发起按钮。mac/route-result.json、proxy-metadata.json、network-proxy.png 留证。没有代理连接或真实请求。

## Android 原生测试包

`android/plums-credential-preflight.apk` 为普通 ARM64 debug 包，限定 API36 ARM64 隔离模拟器；构建为 `PLUMS_ANDROID_TOOLS_ROOT=<既有工具链> npm run android:build`，最终日志 android-build-secure.log。测试使用独立 AVD 数据、ADB 端口和实例，未改动其他模拟器。

原生反例发现输入框未显示密码遮罩，可访问性节点 password=false；key-before.xml 留证。显式设置 PasswordTransformationMethod 后重建原包，浅/深主题均验证 password=true、初始输入获焦、完整合成输入未暴露、窗口带 SECURE；两份 XML 采样中末字符仍可见，符合原生密码模式可短暂显示末字符的行为，本次不声称所有字符始终隐藏。点击取消与系统 Back 后绑定为空，焦点返回录入按钮；android/key-result.json、对应 XML 和 window.txt 留证。密码面板截图受系统保护；未关闭保护来截图。

非秘密代理夹具与 Mac 一致，原生面板保存代理并切回直连，目标保持；撤销取消保留记录。android/route-result.json、proxy-metadata.json、network-proxy.png、route-final.json 留证；实际检查可见布局、系统键盘及确认/取消入口。没有创建/读取/删除 Keystore 测试项或连接代理。

## 交付与剩余验收

当前 `release/mac` 与 `release/android`、此前旧包归档保持原交付。候选只用于本增量限定验证，未作为真实模型接入发布；已确认 UI 沿用，只有连接声明或保留凭据存在时显示新增管理入口。

实际 Keychain/Keystore 保存、读取、删除、拒绝/锁定/失效和签名变化仍未验。受限 TLS/DNS、显式代理传输、请求授权世代、取消/总时限及真实 DeepSeek 调用尚未完成；这些缺口继续由[当前阶段](../docs/spec/milestone.md)维护，阶段不归档。真实操作前分别明确秘密命名空间/设备/清理和外发目标/数据/预算范围，密钥由资源所有者在原生入口输入。

依赖新增/直接使用 security-framework 3.7.0（Mac）、url 2.5.8、http 1.5.0；security-framework-sys 2.17.0 为对应传递项。已核对上述锁定源码的 MIT OR Apache-2.0 元数据，许可证正文保留在依赖源码；native-dependencies.json 保存本次核对，不替代正式分发审计。
