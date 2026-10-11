# 原生安全研究与外部验收前置条件

2026-10-11 在 macOS 27.0.1 arm64、Node 26.5.1、Electron 44.5.1 上研究原生边界。研究轮次见[验收摘要](verification/native-research-2026-10-11.json)，后续默认测试及独立复核见[组合验收](acceptance.md)。项目档位继续返回 `TIER_UNAVAILABLE`。研究轮次的原生全屏焦点检查失败；后续限定权限测试定位器后，完整默认套件通过。该通过不认证项目回收或唯一解释历史焦点失败。

## 项目容器：校准与回收分开判断

[现有 11 项实验](../packages/host/test/project-members.experiments.test.ts)首轮全部在成员校准处失败；最终独立重跑结果单独记录在摘要。成员、控制路径、未沙箱宿主均返回 `1`，`errno` 均为 `0`。这些结果不能区分成员，实验没有进入全局扫描或回收阶段。不能把测试夹具的清理当作容器零残留证据。

| 实验关卡                     | 结果与意义                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 不存在路径标记 V0            | 正负对象均拒绝；不可用于成员判定                                                                                                     |
| 真实文件标记 V1、目录标记 V3 | 简化配置下能区分本次创建的成员和控制对象                                                                                             |
| Mach 名称标记 V2             | 简化配置下能区分成员；私有 API 的过滤常量来自推定值 `2`，尚非稳定公开契约                                                            |
| 配对负控制                   | deny-default 外部进程和不同标记的另一组均未被判为成员；V1/V2 判定一致                                                                |
| 真实项目配置                 | 入口、fork、exec、spawn-setpgroup、暂停的 true-exec 有标记继承证据；setsid/double-fork 未启动，完整控制集合不成立                    |
| 运行环境                     | `sandbox_check(NULL, 0)` 区分宿主 `0` 与已知沙箱 `1`；命名 `no-network` 配置杀死系统 true 与自造 helper，内联拒绝网络配置能运行 true |
| 现有回收与隔离的 11 项验收   | 全部被校准阻断；零残留、并发派生、独立容器隔离和 API 错误路径仍未验收                                                                |

命名配置失败不能单独证明宿主处于外层沙箱。[只读探针](../packages/host/test/project-members-variants.test.ts)因此记录这些事实，并在基础宿主校准成立时继续查询本次拥有的 PID；环境关卡失败仍强制 `INCONCLUSIVE`。探针不执行全局扫描或候选回收，也不改变生产可用性。

进程组基线和同沙箱广播的 8 项原生测试通过：进程组清理留下 double-fork / spawn-setpgroup 后代；同沙箱广播能清理测试中的五类后代而不影响另一独立沙箱和外部哨兵；同沙箱后代也能杀死单收割者留下孤儿。这些通过结论验证了候选路线的局限，不能证明可靠容器。测试先发送非破坏的 SIGCONT 验证范围，再测试终止，见 [project-container.test.ts](../packages/host/test/project-container.test.ts)。

程序路径信任也不足。[路径身份探针](../scripts/probe-project-trust.mjs)只对本次拥有的外部哨兵发送 SIGCONT。普通调用者返回 `-1 / EPERM`，重执行可信路径并注入自造 DYLD 动态库后返回 `0`，哨兵确实收到信号。此实验不用广播信号，没有扫描其他进程；所有直接子进程退出后才删除自己的临时目录。它证明未防重执行/注入的 `process-path` 放行可以授予注入代码同样的信号权。

另有两项静态缺口：现有回收 helper 的初始扫描错误没有完整累计，后续循环又用本轮 `s.errors` 覆盖历史错误；最后一个“错误不得成为零残留”用例没有实际注入 API 错误。相关代码见 [project-members.c](../packages/host/native/project-members.c)。本次没有把未校准的 helper 改成可用，也没有把这些静态风险算成已动态复现。

### 候选路线的取舍

| 路线               | 下一步所需证据                                                                                                         | 当前决定                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 成员标记与外部收割 | 使用真实标记与双控制；按真实配置区分允许后代和被拒操作；验证退出竞争、PID 复用、所有错误保持 unknown、全部 11 项零残留 | 仅有局部只读证据，不接入                 |
| 单收割者或路径放行 | 可信程序不可被后代重执行、注入或终止，且所有脱组后代均可回收                                                           | 已有反例，不采用                         |
| 独立虚拟机         | 独立验证来宾工具链、项目文件共享、凭据/网络边界、宿主关停和异常停止                                                    | 可另立研究范围；未实现、未承诺兼容或性能 |

Apple 的 [VZVirtualMachine.stop](<https://developer.apple.com/documentation/virtualization/vzvirtualmachine/stop(completionhandler:)>) 能强制停止运行或暂停的 VM，且不会给来宾正常退出机会。这提供另一种待研究的生命周期边界，也会带来未保存数据风险。它不是本仓已支持的执行档位。当前保留整机监管限制和项目失败关闭，不用项目自检或管理准备清单授予运行权。

<a id="原生全屏焦点尚未获得系统激活"></a>

## 原生全屏焦点：逐轮证据

研究轮次的原生主题用例在进入全屏前的 `BrowserWindow.isFocused()` 五秒关卡失败，采集值为 `visible:true / focused:false / fullscreen:false`。这些轮次没有验收全屏进入事件，也没有增加等待预算、模拟事件或删除守卫。后续默认组合使用原守卫取得通过记录；逐轮结果见组合验收，历史根因仍未唯一归因。

[焦点诊断脚本](../scripts/probe-desktop-focus.mjs)使用自造临时 profile 与真实管理页面，按五秒预算比较 JS 文件启动、目录启动、regular 激活策略、外部原生激活请求和实际安装副本的直接启动。五种方式均未获得焦点；窗口可聚焦，应用激活策略为 regular，但原生 `NSRunningApplication.active` 仍为 false。原生激活请求返回 true 也没有产生实际激活。

另一次 LaunchServices 尝试返回 `_LSOpenURLsWithCompletionHandler ... -10810`，未形成可用对照。检查未发现该安装副本的残留实例。可以确认“应用未获系统激活”这一失败位置，不能据此唯一归因为 JS 文件入口、Plums 的窗口逻辑或 Electron 缺陷。

Electron 的 [app.focus / setActivationPolicy](https://github.com/electron/electron/blob/main/docs/api/app.md)描述了这些请求。Apple 的[协作激活说明](https://developer.apple.com/documentation/appkit/passing-control-from-one-app-to-another-with-cooperative-activation)明确：激活是请求，系统按上下文决定是否授予，用户界面激活和活动应用让出激活状态影响结果。下一次有效对照需要正常用户激活或可工作的 LaunchServices 环境，再运行原用例；本次未取得该证据。其他桌面通过项不能替代此原生关卡。

## 外部条件：可以准备，尚不能验收

| 工作               | 本地事实                                                                           | 完成真实验收仍需                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Developer ID 签名  | 可用 Developer ID Application 身份数量为 0；安装副本为 ad-hoc，无 Hardened Runtime | 可用的专用签名身份；逐个签署嵌套程序、固定 Node 与原生模块，并验签及真实加载                        |
| 公证与下载分发     | `notarytool` 可用；Gatekeeper 拒绝当前副本；未提交公证或发布                       | 经授权的公证认证、有效签名、上传批准；Accepted 记录、staple/validate 与真实下载的隔离属性及启动验证 |
| 连接器自检         | 宿主准备结果仍是 `prepared / evidence:"declared"`；内部连接测试使用自造服务和凭据  | 独立连接器制品与来源、声明过的检查贡献、精确服务目标、专用测试账号及用户确认                        |
| 独立业务组件符合性 | 内部夹具及自定义适配器不会认证作者；现有报告 `thirdPartyAuthorVerified:false`      | 作者身份/制品摘要/来源审阅、独立实现和隔离验收记录                                                  |

[只读前置条件脚本](../scripts/probe-desktop-prerequisites.mjs)只记录身份数量、签名标志和工具可用性，不记录证书名称、账号或密钥，不读取公证凭据或提交软件。Apple 的[公证要求](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)要求有效 Developer ID 签名及 Hardened Runtime；ad-hoc 不满足该要求。[Developer ID 说明](https://developer.apple.com/developer-id/)解释了签名、公证票据与 Gatekeeper 的分工。

连接自检应由独立连接器实现其声明的检查贡献，使用 [SDK v2 通用连接](sdk-v2.md#通用连接)与保存配置的绑定；宿主只固定 origin、注入声明凭据、确认、复核和审计。真实验收需要覆盖文本回复、多轮历史、用户选定的工具结果回传，以及拒绝、取消、配置变化和旧绑定失效。只读“检查连接”也会产生外发，仍需原有授权和确认；成功结果应只报告协议/模型/调用状态，不回传密钥或正文。不新增宿主模型协议兜底，不把内部自造夹具发布为业务扩展。

## 本地复现

先完成 `pnpm build`，再顺序运行以下命令；不要与构建重叠。原生实验须在允许系统进程探测及 GUI 的环境运行。所有命令使用自造数据，原始缓存不是公开摘要的必要依赖。

```sh
mkdir -p .build-cache/native-research
PLUMS_NATIVE_EXPERIMENTS=1 pnpm exec vitest run packages/host/test/project-members.experiments.test.ts --project experiments --maxWorkers=1
PLUMS_NATIVE_REPORT_DIR=.build-cache/native-research pnpm exec vitest run packages/host/test/project-members-variants.test.ts packages/host/test/project-container.test.ts packages/host/test/project-members.test.ts packages/host/test/project-sandbox.test.ts packages/host/test/project-creation.test.ts --maxWorkers=1
node scripts/probe-project-trust.mjs .build-cache/native-research/trusted-path.json
PLUMS_UI_REPORT_DIR=.build-cache/native-research pnpm exec vitest run packages/desktop/test/onboarding-ui.test.ts -t 'integrates native window' --maxWorkers=1
node scripts/probe-desktop-focus.mjs .build-cache/native-research/focus.json /absolute/test-copy/Plums.app
node scripts/probe-desktop-prerequisites.mjs /absolute/test-copy/Plums.app .build-cache/native-research/prerequisites.json
```

安装副本路径必须指向本次拥有的验收副本。省略焦点脚本的最后一个参数时仅比较四种开发启动方式。`ready:false`、诊断脚本退出成功或记录型测试通过均不表示原生安全、全屏焦点、真实服务或外部作者验收成功。脚本生成的原生 helper 仅用于研究，打包清单拒绝它们。
