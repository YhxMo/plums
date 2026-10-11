import { Switch } from "../components/Switch.js";
import { SelectMenu } from "../components/SelectMenu.js";
import type { DesktopTheme } from "@plumsjs/host";
import { useEffect, useState } from "react";
import { useAction } from "../hooks/useAction.js";
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
  const [location, setLocation] = useState<{
    profilePath: string;
    dataPath: string;
  }>();
  const [dataError, setDataError] = useState("");
  const dataAction = useAction();
  useEffect(() => {
    let current = true;
    void window.manager
      .call("dataLocation")
      .then((value) => {
        if (current && value) setLocation(value as typeof location);
      })
      .catch(() => {
        if (current) setDataError("数据位置未能读取，请重新打开设置页。");
      });
    return () => {
      current = false;
    };
  }, []);
  const runDataAction = (method: string) =>
    dataAction.run(async () => {
      setDataError("");
      try {
        await window.manager.call(method);
      } catch {
        throw Error("操作未完成，请重试。");
      }
    }, false);
  const recoveryError = dataError || dataAction.error;
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
      <h2 className="settings-group-title">本地数据与恢复</h2>
      <div className="settings-panel" data-testid="data-recovery">
        <div className="settings-row">
          <div>
            <strong>停机备份</strong>
            <p>数据保存在本机。完整备份包含密钥，请保存在私有本地目录。</p>
            {location && (
              <>
                <p>
                  完整备份目录：
                  <code className="data-location">{location.profilePath}</code>
                </p>
                <p>
                  Agent 与公共库：
                  <code className="data-location">{location.dataPath}</code>
                </p>
              </>
            )}
            <ol>
              <li>先定位目录，再退出应用。等待窗口关闭与运行进程退出。</li>
              <li>复制完整备份目录，保留公共库、Agent、密钥和数据库文件。</li>
              <li>保留原件。用同版本应用，在独立目录检查恢复副本。</li>
            </ol>
            <p>
              Agent ZIP
              用于分享，不能备份密钥、授权和运行数据。恢复不会重执行任务，活动批准须重新确认。
            </p>
            <p>
              整机入口可能遗留脱组后代。复制前须确认这些进程已停止；退出应用不能保证全部回收。
            </p>
            {recoveryError && <p role="alert">{recoveryError}</p>}
          </div>
        </div>
        <div className="settings-row">
          <button
            disabled={dataAction.pending || !location}
            onClick={() => void runDataAction("revealDataDirectory")}
          >
            在 Finder 中定位
          </button>
          <button
            disabled={dataAction.pending || !location}
            onClick={() => void runDataAction("quitForBackup")}
          >
            退出应用再备份
          </button>
        </div>
      </div>
      <h2 className="settings-group-title">开发者</h2>
      <div className="settings-panel">
        <div className="settings-row">
          <div>
            <strong>开发者模式</strong>
            <p>显示完整组件内容、JSON 编辑与文件定位、开发者调用和原始审计。</p>
            <p>
              组件作者：独立维护组件项目；导入自己的
              ZIP，检查声明与配置，经可信确认后启用，再从执行记录定位调用标识与阶段。新版本只在显式更新的
              Agent 中应用。
            </p>
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
