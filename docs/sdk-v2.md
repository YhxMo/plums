# SDK v2

SDK v2 保留 SDK v1 普通扩展的贡献、设置、角色、事件、能力和依赖调用接口。旧普通扩展无需修改；包格式仍为 2.x，未知字段原样保留。依赖旧内置 `service/model/complete` 的模型组件需要显式升级，宿主不提供协议适配兜底。

## 通用连接

`payload.plumsDesktop.connections` 由 connector 声明。权限来自 manifest 的 `permissions`；连接元信息不单独授予访问权。

```json
{
  "permissions": [
    {
      "id": "api",
      "kind": "service",
      "target": "https",
      "operations": ["request"],
      "reason": "查询远程数据"
    }
  ],
  "settingsSchema": {
    "type": "object",
    "properties": {
      "endpoint": {
        "type": "string",
        "title": "Base URL",
        "description": "公共 HTTPS 地址"
      },
      "apiKey": {
        "type": "string",
        "title": "API Key",
        "description": "连接凭据",
        "x-secret": true
      }
    }
  },
  "payload": {
    "plumsDesktop": {
      "sdkVersion": "2",
      "connections": [
        {
          "id": "api",
          "permissionId": "api",
          "baseURLSetting": "endpoint",
          "credentials": [
            {
              "setting": "apiKey",
              "header": "Authorization",
              "prefix": "Bearer "
            }
          ]
        }
      ]
    }
  }
}
```

地址、可选 `labelSetting` 及 `selectorSetting` 必须引用本组件的非密钥字符串设置；密钥头必须引用本组件的 x-secret 设置。`selectorSetting` 的枚举可对应 `credentialProfiles`，所有枚举值必须有声明配置。选择值由已保存设置决定，宿主不解释它的协议或服务含义。`credentials` 和 `credentialProfiles` 不能同时声明。

`await sdk.connection("api")` 返回 `{binding, baseURL, origin, basePath, fingerprint, ready}`。不包含密钥值。指纹覆盖声明、已保存配置、启用状态及设置/密钥修改版本；设置、密钥、声明和启用状态变化后，旧连接授权失效。`sdk.context()` 返回当前 Agent、组件及此次实际调用的标识。

```js
const connection = await sdk.connection("api");
const response = await sdk.capability("api", {
  kind: "service",
  operation: "request",
  binding: connection.binding,
  sources: [],
  input: {
    path: "/v1/resource",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  },
});
const { status, headers, body } = response.result;
```

路径须以 `/` 开头且解析后属于固定的 HTTPS origin。宿主拒绝 origin 变更、URL 中凭据、私有地址、重定向、无效头、超限及过期授权；复用 DNS/TLS、取消、脱敏和执行前复核。请求头不能覆盖声明绑定的凭据。请求正文、业务消息、请求路径和回复解析由外装组件构造。

其他 2.x `service` 权限继续采用自己的 read/write/egress 效果；外部写入仍逐次确认。HTTPS 外发使用通用 egress 效果，需短期任务范围或单次确认，并复核调用链各方的绑定批准。

## 响应失败

外装解析器可调用 `sdk.failResponse(response.callId, "RESPONSE_INVALID")`，或在非 2xx 状态时调用 `"HTTP_REJECTED"`。宿主只接受当前组件、当前调用实际完成的请求凭据，返回真实 callId、HTTP 状态和 `executionState: completed`；不能自报执行状态、冒用另一组件的请求或复用前次调用凭据。

失败审计不保存响应正文。审计失败仍返回真实执行状态；已完成或未确定的请求不得自动重试。

## 可信引擎

`plumsDesktop.engines` 声明引擎 id、标题、包内入口、固定 Node runtime、支持平台和 `jsonrpc-jsonl-v1`。每个引擎须对应唯一 `kind: engine`、`target: 引擎 id` 的公开权限。

SDK `engine.start/request/cancel/stop/status` 只能控制当前组件声明的引擎。业务前端也有绑定当前组件的 `window.plums.engine`，可独立取消正在执行的长任务。用户长期信任、真实确认、JSONL 协议、受控回调及进程监管详见 [可信引擎](engine.md)。SDK 不提供写入长期授权、管理 Agent、读取密钥明文或指定任意可执行路径的接口。
