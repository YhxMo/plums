import type { SettingsDescription } from "@plums/core";

/** Required configuration still missing from the host's settings description. */
export function missingRequiredSettings(
  settings: SettingsDescription,
): string[] {
  return (settings.schema?.required ?? []).filter((key) =>
    settings.schema!.properties[key]?.["x-secret"]
      ? !settings.secrets[key]
      : settings.values[key] === undefined ||
        (typeof settings.values[key] === "string" &&
          !(settings.values[key] as string).trim()),
  );
}
