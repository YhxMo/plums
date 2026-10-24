import type { Manifest } from "@modules/sdk";

/** `manifest` names the sites `network.read` may reach. */
export const capabilityLabel = (
  capability: string,
  manifest?: Pick<Manifest, "networkSources">,
) =>
  ({
    "state.read": "读取隔离状态",
    "state.write": "写入隔离状态",
    "state.batch": "一次写入多项隔离状态",
    "records.list": "读取隔离记录",
    "records.search": "搜索隔离记录",
    "platform.info": "查看平台信息",
    "link.open": "在浏览器中打开网页链接（仅 https）",
    "document.read": "只读访问本次选择的文档（最多64 KiB）",
    "credential.request": "通过已授权连接发送请求",
    "credential.connect":
      "新建和管理自己的连接（密钥交给本机应用保存，扩展之后读不到）",
    "network.read": `读取公开网络资源（${
      manifest?.networkSources
        ?.map((source) => new URL(source).hostname)
        .join("、") || "未声明来源"
    }，不带密钥）`,
  })[capability] ?? capability;
