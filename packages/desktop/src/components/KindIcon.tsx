import { Icon } from "./Icon.js";
import type { ComponentKind } from "../shared/terms.js";
export { kindLabel, type ComponentKind } from "../shared/terms.js";
export function KindIcon({
  kind,
  size = 36,
}: {
  kind: ComponentKind;
  size?: number;
}) {
  return (
    <span
      className="kind-icon"
      data-kind={kind}
      style={{ width: size, height: size }}
    >
      <Icon name={kind} size={size <= 24 ? 16 : 20} />
    </span>
  );
}
