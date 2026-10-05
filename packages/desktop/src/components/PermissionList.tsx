import type { Permission } from "@plums/core";
import { permissionCopy } from "../shared/permission-copy.js";
import { Icon } from "./Icon.js";
export function PermissionList({
  permissions,
  formatVersion,
  serviceTargets,
}: {
  permissions: Permission[];
  formatVersion?: string;
  serviceTargets?: Record<string, string[]>;
}) {
  return (
    <div className="permission-list">
      {permissions.length ? (
        permissions.map((permission, index) => (
          <div key={`${permission.id}-${index}`}>
            <Icon name="shield" size={16} />
            <div>
              <strong>
                {permissionCopy(
                  permission,
                  formatVersion,
                  serviceTargets?.[permission.id],
                )}
              </strong>
              <p>
                <span>作者说明：</span>
                {permission.reason}
              </p>
            </div>
          </div>
        ))
      ) : (
        <p>此组件未声明外部访问权限。</p>
      )}
    </div>
  );
}

export function PermissionSummary({
  permissions,
}: {
  permissions: {
    permission: Permission;
    formatVersion: string;
    serviceTargets?: string[];
  }[];
}) {
  const groups = new Map<
    string,
    {
      permission: Permission;
      formatVersion: string;
      serviceTargets?: string[];
    }[]
  >();
  for (const entry of permissions)
    groups.set(entry.permission.target, [
      ...(groups.get(entry.permission.target) ?? []),
      entry,
    ]);
  return (
    <div className="permission-list">
      {groups.size ? (
        Array.from(groups, ([target, entries]) => (
          <div key={target}>
            <Icon name="shield" size={16} />
            <div>
              <strong>
                {target === "https"
                  ? "当前 HTTPS 服务"
                  : target.startsWith("*.")
                    ? `${target.slice(2)} 及其子站`
                    : target}
              </strong>
              {Array.from(
                new Set(
                  entries.map((entry) =>
                    permissionCopy(
                      entry.permission,
                      entry.formatVersion,
                      entry.serviceTargets,
                    ),
                  ),
                ),
              ).map((description) => (
                <p key={description}>{description}</p>
              ))}
            </div>
          </div>
        ))
      ) : (
        <p>已启用组件未声明外部访问权限。</p>
      )}
    </div>
  );
}
