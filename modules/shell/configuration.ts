import type { Host } from "@modules/extension-host/host";
import {
  resolveConfiguration,
  type Configuration,
} from "@modules/sdk/configuration";

/** Validate before stop; publish only after storage confirms. A failed save leaves the extension stopped. */
export async function saveConfiguration(
  host: Pick<Host, "manifest" | "inspect" | "stop" | "configure" | "start">,
  id: string,
  input: unknown,
  save: (value: Configuration) => Promise<void>,
) {
  const value = resolveConfiguration(host.manifest(id).configuration, input);
  const desired = host.inspect(id).desired;
  await host.stop(id);
  await save(value);
  await host.configure(id, value);
  if (desired) await host.start(id);
}
