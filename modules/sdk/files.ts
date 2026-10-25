/**
 * Experimental: saves a file where the person chooses. The app shows the
 * system's save panel with `name` suggested and writes the bytes there; the
 * browser preview downloads it. Resolves `{ saved: false }` when the person
 * cancels.
 */
export interface FileSaveRequest {
  version: 1;
  /** The suggested file name, without folders, ending in .png or .plums. */
  name: string;
  /** The file's bytes as base64, at most `MAX_SAVE_BYTES` once decoded. */
  data: string;
}
export type FileSaveResult = { saved: boolean };

/** Largest file `file.save` writes. */
export const MAX_SAVE_BYTES = 32 * 1024 * 1024;
/** The kinds of file `file.save` writes, by extension. */
export const SAVE_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".plums": "application/zip",
};

/** The media type of a name `file.save` accepts, or undefined. */
export function savedType(name: unknown): string | undefined {
  if (typeof name !== "string" || name.length > 200) return undefined;
  if (/[/\\:\0]/.test(name) || name.startsWith(".")) return undefined;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? SAVE_TYPES[name.slice(dot).toLowerCase()] : undefined;
}

/** Whether `data` is base64 within the size limit. */
export function savableData(data: unknown): data is string {
  return (
    typeof data === "string" &&
    data.length <= Math.ceil(MAX_SAVE_BYTES / 3) * 4 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(data) &&
    data.length % 4 === 0
  );
}
