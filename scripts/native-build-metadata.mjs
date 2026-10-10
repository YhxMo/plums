import { cp } from "node:fs/promises";
import path from "node:path";

/** node-gyp setup files contain build-machine paths and are not runtime inputs. */
export function isNativeBuildMetadata(relative) {
  return /^build\/(Makefile|config\.gypi|[^/]+\.mk)$/i.test(
    relative.replaceAll("\\", "/"),
  );
}

export async function copyNativeRuntime(source, destination) {
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    filter: (file) => !isNativeBuildMetadata(path.relative(source, file)),
  });
}
