import type { ShellNavigation } from "./useShellNavigation";
import { RailButton } from "./RailButton";
import { extensionsIcon, settingsIcon } from "./icons";
import { MaskIcon } from "@/components/MaskIcon";

/**
 * The shell's own destinations, extension management and settings: at the
 * foot of the rail on desktop, in the title bar on phones.
 */
export function ShellEntries({
  navigation,
  place,
}: {
  navigation: Pick<
    ShellNavigation,
    "manager" | "openManager" | "closeManager" | "setDialog"
  >;
  place: "rail" | "bar";
}) {
  const managerOpen = navigation.manager.open;
  const rail = place === "rail";
  const button = rail ? "size-11 rounded-xl" : undefined;
  const icon = rail ? undefined : "size-5";
  return (
    <>
      <RailButton
        label="扩展"
        data-shell-entry="extensions"
        side={rail ? "right" : "bottom"}
        active={managerOpen}
        className={button}
        onClick={() =>
          managerOpen ? navigation.closeManager() : navigation.openManager()
        }
      >
        <MaskIcon svg={extensionsIcon} name="extensions" className={icon} />
      </RailButton>
      <RailButton
        label="设置"
        data-shell-entry="settings"
        side={rail ? "right" : "bottom"}
        className={button}
        onClick={(source) => navigation.setDialog("settings", source)}
      >
        <MaskIcon svg={settingsIcon} name="settings" className={icon} />
      </RailButton>
    </>
  );
}
