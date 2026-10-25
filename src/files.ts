import { invokeNative } from "./native/invoke";
import { platformRejection } from "@modules/sdk";
import {
  savableData,
  savedType,
  type FileSaveResult,
} from "@modules/sdk/files";

/**
 * `file.save`: the app asks the system where to save and writes the bytes
 * there natively; the browser preview downloads the file.
 */
export async function saveFile(
  owner: string,
  payload: unknown,
  native: boolean,
): Promise<FileSaveResult> {
  const { version, name, data } = (payload ?? {}) as Record<string, unknown>;
  const fields =
    payload && typeof payload === "object"
      ? Object.keys(payload).sort().join()
      : "";
  const type = savedType(name);
  if (
    fields !== "data,name,version" ||
    version !== 1 ||
    !type ||
    !savableData(data)
  )
    throw platformRejection("无法保存这个文件。");
  if (!native) {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name as string;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { saved: true };
  }
  let outcome: unknown;
  try {
    outcome = await invokeNative("file_save", {
      owner,
      name: name as string,
      data,
    });
  } catch (error) {
    throw Object.assign(platformRejection("文件没有保存。"), {
      cause: error,
    });
  }
  return { saved: outcome === "saved" };
}
