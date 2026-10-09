import { useState } from "react";
import type { TierPlan, ProjectBoundaryReport } from "@plums/host";

export interface CacheStatus {
  packageId: string;
  bytes: number;
  files: number;
}
export function ProjectSupport({
  entries,
  cache,
  pending = false,
  clear,
  boundary,
  check,
  refreshConfiguration,
  credentials,
}: {
  entries: TierPlan["entries"];
  cache: CacheStatus[];
  pending?: boolean;
  clear?: (packageId: string) => void;
  boundary?: ProjectBoundaryReport;
  check?: () => void;
  refreshConfiguration?: () => void;
  credentials?: (
    packageId: string,
    engineId: string,
    credentialId: string,
    value?: string,
    username?: string,
  ) => void;
}) {
  return (
    <section className="local-project-support" aria-label="项目运行配套">
      <h3>项目运行配套</h3>
      <p role="status">
        {boundary
          ? `项目自检：${boundary.status === "passed" ? "边界检查通过" : boundary.status === "skipped" ? "平台不支持" : "边界检查失败"}；${boundary.ready ? "运行可用" : "项目档位不可用"}。${boundary.checks.filter((c) => c.status === "passed").length}/${boundary.checks.length} 项通过。`
          : "尚未自检。项目档位不可用。"}
      </p>
      {!!boundary?.knownRisks.length && (
        <p>
          已知风险：运行期非后代新增硬链接别名，{boundary.knownRisks.length}{" "}
          项真实探测。
        </p>
      )}
      {check && (
        <button disabled={pending} onClick={check}>
          重新自检项目边界
        </button>
      )}
      {refreshConfiguration && (
        <button disabled={pending} onClick={refreshConfiguration}>
          读取配置允许字段
        </button>
      )}
      <p>
        项目启动当前不可用。项目档位仅适用于受信任项目，建议纳入版本控制并保持提交干净以便回滚，宿主不提供回滚。硬链接创建拦截与启动前校验不是内核级
        inode 防线，非后代进程运行期新增别名仍有风险。
      </p>
      {entries.flatMap((entry) =>
        entry.engines
          .filter((e) => e.tier === "project")
          .map((engine) => (
            <div key={entry.packageId + "/" + engine.engineId}>
              <h4>
                {entry.name} · {engine.engineId}
              </h4>
              <dl>
                <div>
                  <dt>工具链</dt>
                  <dd>
                    {engine.toolchains?.length
                      ? engine.toolchains.map((t) => (
                          <p key={t.name}>
                            {t.name}：
                            {t.found ? t.root : "未找到（可稍后重新探测）"}
                          </p>
                        ))
                      : "尚无探测结果"}
                  </dd>
                </div>
                <div>
                  <dt>配置允许字段</dt>
                  <dd>
                    {engine.configuration?.length
                      ? engine.configuration.map((c) => (
                          <p key={c.tool + "." + c.field}>
                            {c.tool}.{c.field} = {c.value}
                          </p>
                        ))
                      : "尚无允许字段"}
                    。仅显式读取允许字段；认证令牌默认不复制。项目运行接线仍未完成。
                  </dd>
                </div>
                <div>
                  <dt>代理主机</dt>
                  <dd>
                    {engine.hosts.join("、") || "无已批准主机"}
                    。项目入口代理尚未接入。
                  </dd>
                </div>
                <div>
                  <dt>凭据声明</dt>
                  <dd>
                    {engine.credentials?.length
                      ? engine.credentials.map((c) => (
                          <Credential
                            key={c.id}
                            item={c}
                            pending={pending}
                            enabled={
                              engine.state === "confirmed" &&
                              engine.hosts.includes(c.host)
                            }
                            change={
                              credentials
                                ? (value, username) =>
                                    credentials(
                                      entry.packageId,
                                      engine.engineId,
                                      c.id,
                                      value,
                                      username,
                                    )
                                : undefined
                            }
                          />
                        ))
                      : "尚未声明凭据"}
                    。批准只对当前入口和主机有效；项目运行时注入尚未接入。
                  </dd>
                </div>
              </dl>
            </div>
          )),
      )}
      <h4>Agent 缓存</h4>
      {cache.map((item) => (
        <div className="root-row" key={item.packageId}>
          <span>
            {entries.find((e) => e.packageId === item.packageId)?.name ??
              item.packageId}
            ：{item.bytes} 字节 · {item.files} 个文件
          </span>
          {clear && (
            <button
              disabled={pending || (item.bytes === 0 && item.files === 0)}
              onClick={() => clear(item.packageId)}
            >
              清空缓存
            </button>
          )}
        </div>
      ))}
      <p>项目进程的缓存重定向与按主机凭据注入尚未接入。</p>
    </section>
  );
}

function Credential({
  item,
  pending,
  enabled,
  change,
}: {
  item: TierPlan["entries"][number]["engines"][number]["credentials"][number];
  pending: boolean;
  enabled: boolean;
  change?: (value?: string, username?: string) => void;
}) {
  const [value, setValue] = useState(""),
    [username, setUsername] = useState("");
  const user = item.kind === "git-https" || item.kind === "pip-index-auth";
  return (
    <div className="local-credential">
      <p>
        {item.kind} → {item.host} · {item.reason || "未声明用途"} ·{" "}
        {item.approved ? "已批准" : "未批准"}
      </p>
      {change && (
        <>
          {!enabled && <p>先确认此入口与对应主机。</p>}
          <label>
            凭据（{item.id}）
            <input
              type="password"
              autoComplete="new-password"
              value={value}
              disabled={pending || !enabled}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          {user && (
            <label>
              登录名（{item.id}）
              <input
                type="password"
                autoComplete="off"
                value={username}
                disabled={pending || !enabled}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
          )}
          <button
            disabled={
              pending ||
              !enabled ||
              !value ||
              (item.kind === "git-https" && !username)
            }
            onClick={() => {
              const secret = value,
                login = username;
              setValue("");
              setUsername("");
              change(secret, login || undefined);
            }}
          >
            批准凭据 {item.id}
          </button>
          {item.approved && (
            <button disabled={pending} onClick={() => change()}>
              撤销凭据 {item.id}
            </button>
          )}
        </>
      )}
    </div>
  );
}
