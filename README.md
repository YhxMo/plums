# plums

Plums 内核（Apache-2.0）。pnpm 单仓库，包含：

- `@plums/core`：TypeScript 内核库
- `plums`：命令行。只调用库的公开 API；当前运行后打印版本号

## 环境

Node.js 22 或更新的 LTS，以及 pnpm 10。

## 命令

```sh
pnpm install
pnpm build
pnpm test
pnpm exec plums
```

`pnpm test` 会先构建，再跑 Vitest。`plums` 打印 `@plums/core` 的版本号。

## 已知限制

- 更新一个包时，不检查别的包是否依赖它的旧版本（不检查反向依赖）。
- 卸载一个包时，不检查别的包是否依赖它。依赖它的包会在下次启用时返回 `DEPENDENCY_MISSING`。
- 内核不做 DNS 解析。真实的 `EgressSink` 必须在解析后拒绝回环、内网和链路本地地址。
- 通配符只数域名标签，`*.co.uk` 和 `*.github.io` 仍可通过；公共后缀由宿主限制，因为内核不维护一份会过期的公共后缀清单。
- 内核不跟随重定向。`EgressSink` 返回 `redirectTo` 时，内核原样交还给调用方；要继续，调用方用新地址再调一次 `runAction`。
- 以点结尾的主机名一律拒绝（reason 为 `TRAILING_DOT`）。

## 残留设置

导入时，如果 `data/<id>/settings.json` 已经在，按新包的 `settingsSchema` 校验。缺必填、类型不对、或比原值更严，是 `IMPORT_INVALID`，path 为 `/settings/<key>`，不写安装记录，包文件也不会留下。残留文件不是合法 JSON，或新包没有 `settingsSchema`，同样拒绝，path 为 `/settings`（没有设置项时不读取文件内容），文件原样留下。想导入一个没有 `settingsSchema` 的包，要先删掉 `data/<id>/settings.json`。

更新到有 `settingsSchema` 的新版时，残留文件按同样的规则检查，不通过则已安装的旧版保持不变。更新到没有 `settingsSchema` 的新版时，这份文件不读不删，更新继续。

`setSettings` 在写入前检查必填、类型、范围和 enum。失败是 `SETTINGS_INVALID`，path 为 `/settings/<key>`，文件不改，错误信息不含被拒的值。`x-secret` 引用不合法或密钥不存在仍是 `SECRET_NOT_FOUND`。错误码一共十个，多出来的就是 `SETTINGS_INVALID`。

## 宿主契约

- 宿主在每次写入（write）之前，必须先调用 `core.runAction`，通过后才能写。内核对 write 只检查和放行，不执行写入。
- write 权限的 `target` 内核不解释。宿主必须自行约束写入的范围，不能超出用户同意的范围。
- 宿主实现的 `confirm.ask` 按 [docs/confirm-copy.md](docs/confirm-copy.md) 展示确认框。
