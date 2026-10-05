import { Switch } from "../components/Switch.js";
export function SettingsView({
  dnsMode,
  busy,
  developer,
  onDeveloper,
  onDns,
}: {
  dnsMode: string;
  busy: boolean;
  developer: boolean;
  onDeveloper: (value: boolean) => void;
  onDns: (value: string) => void;
}) {
  return (
    <div className="settings-view">
      <section className="page-header">
        <div>
          <h1>设置</h1>
          <p>调整工作台的外观、网络和开发者工具。</p>
        </div>
      </section>
      <h2 className="settings-group-title">外观</h2>
      <div className="settings-panel">
        <div className="settings-row">
          <div>
            <strong>跟随系统</strong>
            <p>浅色与深色随系统外观自动切换。</p>
          </div>
          <span>自动</span>
        </div>
      </div>
      <h2 className="settings-group-title">网络</h2>
      <div className="settings-panel">
        <div className="settings-row">
          <div>
            <strong>域名解析</strong>
            <p>
              自动模式遇到代理返回的保留地址时，会用 Cloudflare 加密 DNS
              查询公网地址。只发送域名，不发送 API Key 或会话内容。
            </p>
          </div>
          <select
            aria-label="域名解析方式"
            value={dnsMode}
            disabled={busy}
            onChange={(event) => onDns(event.target.value)}
          >
            <option value="auto">自动（适配代理网络）</option>
            <option value="system">系统 DNS</option>
            <option value="cloudflare">公共加密 DNS (Cloudflare)</option>
          </select>
        </div>
      </div>
      <h2 className="settings-group-title">开发者</h2>
      <div className="settings-panel">
        <div className="settings-row">
          <div>
            <strong>开发者模式</strong>
            <p>显示组件标识、JSON 调用与原始审计，仅改变界面显示。</p>
          </div>
          <Switch
            label="开发者模式"
            checked={developer}
            onChange={onDeveloper}
          />
        </div>
      </div>
    </div>
  );
}
