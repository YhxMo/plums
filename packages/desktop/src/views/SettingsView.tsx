import { Switch } from "../components/Switch.js";
import { SelectMenu } from "../components/SelectMenu.js";
import type { DesktopTheme } from "@plumsjs/host";
export function SettingsView({
  dnsMode,
  theme,
  themeBusy,
  themeError,
  busy,
  developer,
  onDeveloper,
  onDns,
  onTheme,
}: {
  dnsMode: string;
  theme: DesktopTheme;
  themeBusy: boolean;
  themeError: string;
  busy: boolean;
  developer: boolean;
  onDeveloper: (value: boolean) => void;
  onDns: (value: string) => void;
  onTheme: (value: DesktopTheme) => void;
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
            <strong>外观主题</strong>
            <p>选择浅色、深色，或跟随系统外观自动切换。</p>
            {themeError && (
              <p role="alert" className="error-text">
                {themeError}，请重新选择重试。
              </p>
            )}
          </div>
          <SelectMenu
            className="theme-select"
            label="外观主题"
            value={theme}
            disabled={themeBusy}
            onChange={(value) => onTheme(value as DesktopTheme)}
            options={[
              { value: "system", label: "跟随系统" },
              { value: "light", label: "浅色" },
              { value: "dark", label: "深色" },
            ]}
          />
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
            <p>显示完整组件内容、JSON 编辑与文件定位、开发者调用和原始审计。</p>
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
