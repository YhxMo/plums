# 在桌面应用中管理执行底座

底座执行 Agent 中的扩展。Plums 离线内置官方底座；第三方底座可以导入公共库。每个 Agent 固定选择具体来源、版本和 ZIP 摘要，应用升级不会自动替它更换底座。兼容诊断依据声明，不能当成完整 SDK 行为认证。

## 查看与选择

打开「设置 → 执行底座」查看官方制品和第三方公共库制品。列表显示来源、版本、平台、摘要和引用数。Agent 详情页也提供同一管理入口；没有前端、没有角色卡或没有组件的 Agent 仍可管理。

1. 导入底座 ZIP。官方 ZIP 验证应用内的信任公钥；第三方 ZIP 按公开提供者声明和不可变库摘要检查。导入本身不执行提供者，不批准业务权限，不改变 Agent 当前选择。
2. 在 Agent 的「选择底座」中选具体制品，再点击「检查兼容」。宿主检查 Agent 需求和所有有 runtime 的组件，包括停用组件。不同组件的 SDK 主线分别检查。
3. 阅读结果后点击「切换并启用」。宿主撤销旧实例和本次任务授权，等待任务、进程与快照清理，再完成持久切换。原配置、密钥引用、组件同意和业务数据保留。
4. 按原流程启用组件、确认权限并批准本次任务范围。底座切换不会替代这些步骤。

停用底座保留选择和数据；再次启用必须重新检查制品与需求。被任何 Agent 引用的制品不能删除，停用 Agent 也算引用。当前应用自带的默认官方制品始终保留。修改应用默认只影响新建或无绑定旧记录。

新建 Agent 的组装窗口可以显式选底座，也可以固定本次应用的官方默认。创建时再检查全部需求，兼容失败保留组装表单供修改。现有 Agent 在详情页切换。

## 导入 Agent ZIP

保留「直接使用」和「继续组装」两种选择。直接使用仍需填写组件 schema 配置、查看权限并启用组件。继续组装收藏组件，同时保留 ZIP 的底座需求与精确选择；组装窗口可以重新选择符合需求的底座。

`agent.json.foundation` 可含：

```json
{
  "selection": {
    "selectionVersion": "1.0",
    "source": "builtin",
    "id": "org.plums.foundation",
    "version": "1.0.0",
    "digest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
}
```

这个摘要仅为结构示例，不能运行。`requirement` 可与 `selection` 一起提供；只提供需求表示待选择，不能自动运行或退回默认。缺少选择的 ZIP 引导到继续组装。未知 selection/requirement major 在解析时拒绝，并指出 JSON Pointer；保留原 ZIP，用支持该版本的应用继续处理。

公开 Agent foundation 格式现在接受只有 selection 的记录，也接受既有 requirement + 可选 selection。空对象仍拒绝。此变化为便携固定选择增加表达能力；旧版严格解析器可能拒绝 selection-only ZIP，应升级解析器，不丢弃选择来运行。

导出总是携带本 Agent 的精确底座选择，保留显式需求及未知字段。ZIP 不携带本机底座安装身份、组件安装身份、密钥、设置值、批准、租约、句柄或运行数据；导出继续检查已知秘密。底座制品不自动塞入 Agent ZIP，可从底座列表单独导出，随 Agent ZIP 离线传递。

接收端缺少所选制品，或制品不满足需求时，直接导入会保留组件和原选择，底座保持停用，进入管理修复状态。组件不获得同意或启用。新建组装仍严格要求选择可用且兼容。运行、启用、组合变化和切换继续复核全部要求；导入不是授权。

## 缺失、不兼容与恢复

| 状态                                     | 可执行操作                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| 当前官方对象缺失或损坏                   | 点击「修复当前内置制品」，从健康应用内恢复相同字节；已有选择与授权保持               |
| 旧官方或第三方固定制品缺失               | 导入同一个原始 ZIP；也可检查另一候选后显式切换                                       |
| 必需 SDK、功能、平台或数据格式不兼容     | 查看诊断，选择满足声明的制品；数据格式需要适配时保留业务内容，不隐式转换             |
| 另一宿主占用该 Agent                     | 可信宿主调用 `stopSession`；桌面无单 Agent 会话释放入口时退出另一应用，再检查与切换  |
| 事务或本地记录损坏、未来版本、清理未结束 | 管理入口仍显示阻断状态；「重试保留数据的恢复」仅执行已定义恢复，不改写损坏或未来记录 |
| 原始记录本身不可读                       | 在设置页保留按 Agent 标识定位的恢复项；从可信备份修复或使用支持该记录版本的应用      |

当前应用的执行字节校验失败时，「修复当前内置制品」也会拒绝。保留数据目录，修复或重装可信应用，再重试；该按钮只能恢复对象库中的 ZIP。返回管理或隐藏前端不会释放宿主会话。

恢复不会自动运行旧工作、恢复任务范围或租约，也不会重新播放 unknown/completed 副作用。激活标记之前恢复旧选择，标记之后保留新选择；损坏证据和业务数据留在本地。

## 官方离线制品与构建

构建生成 `packages/host/dist/foundation-resources/official.zip`，桌面构建复制到 `packages/desktop/dist/foundation-resources/`。打包后的应用在 `Contents/Resources/app/dist/foundation-resources/` 携带同一原始 ZIP 和公开 trust catalog。干净数据目录无需联网或示例包即可创建空 Agent，并固定这份官方制品。

官方 ZIP 是权限为空的 2.x extension，`payload.plumsFoundation.execution` 为可信 `builtin-adapter`。它有独立 `code/adapter.mjs`、worker、受控 worker/supervisor、原生辅助和针对 Node 26.5.1 的 isolated-vm/node-gyp-build 运行依赖字节；不把新版应用 Runtime 代替旧制品。由应用认可的 Ed25519 公钥验证后，才能使用可信官方 ABI 加载。第三方库路径仍拒绝自行声明 builtin-adapter，独立第三方作者走公开 controlled-node/JSONL 协议。

`official.json` 的 `artifactVersion: 1`、`adapterAbi: 1`、`nodeVersion`、`platform`、`provider`、具体 `version` 、`hostDigest` 和完整当前宿主文件摘要 `hostFiles` 描述官方制品。`signature.json` 的 `signatureVersion: 1` 和 base64 Ed25519 signature 签署其余全部文件的 SHA-256 inventory：文件名按默认 JS 字符串排序，形成 `{相对路径: 小写摘要}`，再用无空白 `JSON.stringify(inventory)` 的 UTF-8 字节签名。签名不取代原始 ZIP digest；选择仍固定原 ZIP。`trust.json` 的 `trustVersion: 1`、`publicKeys` PEM 数组与 `current` 选择由可信应用交付。

ABI 1 的 `code/adapter.mjs` 导出 `createOfficialFoundationSession(options, nodePath)` 和自己的 `PlumsError`；options 为公开可信 `FoundationAdapterOptions`，包括宿主签发的 binding、已验证组件快照、授权桥、同步/异步复核与进程/快照登记函数。返回公开 `HostFoundationSession`。加载器只从已验证归档写入私有登记快照，适配不能获得管理接口；SDK/权限/策略/schema 仍由公共宿主守门。不同模块的公开错误通过可信适配边界转换，保留真实 code/path/details 和执行凭据。

每次创建读取精确归档，等待后按原规则复核。停止与关闭等待实际进程退出，成功删除快照后才释放持久清理责任。归档和旧版本不会随当前默认替换；引用保护包括停用绑定。官方源码与 native 依赖均来自该选择的归档，宿主服务和固定 Node 属于公共宿主边界。

当前应用的 canonical bundle 与编译输入另外校验。新版应用可运行受信任的旧官方归档；当前应用执行字节被修改时仍拒绝。唯一已审阅内部 canonical ZIP 通过显式固定 SHA-256 迁移入口保留执行，旧字节不变，外部 native 依赖沿用这次迁移的宿主安装。其他未知 unsigned ZIP 不能进入 builtin 路径。

`build-official-foundation.mjs` 在本地开发时生成并复用 `.build-cache/foundation-signing/private.pem`，私钥不进入源码、ZIP、应用或证据快照。正式发布构建须用 `PLUMS_OFFICIAL_SIGNING_KEY` 指定稳定发布身份；更换发布信任根需用 `PLUMS_OFFICIAL_TRUST_KEYS` 指定含旧 PEM 公钥的 JSON 数组文件。当前本地制品只证明本次构建的签名连续性，不宣称上游发行认证。旧制品若不在应用信任根中，只保留记录并报告不可用，不降级为信任任意本机 ZIP。

完整第三方 SDK 黑盒符合性和专门验证扩展/Agent 整合包仍延期到 6/7B。当前第三方执行证据仅为 SDK 2.0.0 register/settings/context/capability 与原生 fs/list。
