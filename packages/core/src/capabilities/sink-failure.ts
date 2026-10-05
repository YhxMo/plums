const messages = {
  DESTINATION_REFUSED: "服务地址不符合联网要求，请检查接口地址。请求没有发出。",
  DNS_FAILED: "无法解析服务域名，请检查网络连接。请求没有发出。",
  DNS_RESERVED_ADDRESS:
    "服务域名被解析为内网或保留地址。请使用自动域名解析。请求没有发出。",
  REQUEST_INVALID: "服务请求配置无效。请求没有发出。",
  HTTP_REJECTED: "服务拒绝了请求，请检查服务配置、凭据或账户权限。",
  RESPONSE_INVALID: "服务已返回响应，但响应格式无效。请检查接口协议。",
} as const;
export type SinkFailureReason = keyof typeof messages;
const outcomes = new WeakMap<
  object,
  Readonly<{
    reason: SinkFailureReason;
    message: string;
    executionState: "not_started" | "completed";
    httpStatus?: number;
  }>
>();

/** Trusted sinks may report a known outcome, without passing through remote text or exceptions. */
export class SinkFailure extends Error {
  readonly executionState: "not_started" | "completed";
  constructor(
    readonly reason: SinkFailureReason,
    readonly httpStatus?: number,
  ) {
    if (
      !Object.hasOwn(messages, reason) ||
      (httpStatus !== undefined &&
        (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599))
    )
      throw new TypeError("Invalid sink failure");
    super(
      messages[reason] +
        (httpStatus === undefined ? "" : `（HTTP ${httpStatus}）`),
    );
    this.name = "SinkFailure";
    this.executionState =
      reason === "HTTP_REJECTED" || reason === "RESPONSE_INVALID"
        ? "completed"
        : "not_started";
    outcomes.set(
      this,
      Object.freeze({
        reason,
        message: this.message,
        executionState: this.executionState,
        ...(httpStatus === undefined ? {} : { httpStatus }),
      }),
    );
    Object.freeze(this);
  }
  static describe(error: unknown) {
    return error !== null && typeof error === "object"
      ? outcomes.get(error)
      : undefined;
  }
}
