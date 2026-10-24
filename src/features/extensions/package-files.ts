import { readZip, type PackageFile } from "@modules/shell/extension-package";

const isZip = (file: File) =>
  /\.zip$/i.test(file.name) || file.type === "application/zip";
/** Only these two files make a package; nothing else is read. */
const wanted = (name: string) => name === "manifest.json" || name === "main.js";

/**
 * Picked files: one zip, or a package's files. Files from a picked folder
 * keep their path inside it.
 */
export function pickedFiles(
  files: File[],
): Promise<PackageFile[]> | PackageFile[] {
  if (files.length === 1 && isZip(files[0])) return readZip(files[0]);
  return files
    .filter((file) => !file.webkitRelativePath || wanted(file.name))
    .map((file) => ({
      path: file.webkitRelativePath || file.name,
      data: file,
    }));
}

/** Dropped items: a folder is searched two levels deep, a zip unpacked. */
export async function droppedFiles(
  transfer: DataTransfer,
): Promise<PackageFile[]> {
  const entries = [...transfer.items]
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry);
  if (!entries.some((entry) => entry.isDirectory))
    return pickedFiles([...transfer.files]);
  const found: PackageFile[] = [];
  for (const entry of entries) await collect(entry, "", 0, found);
  return found;
}

async function collect(
  entry: FileSystemEntry,
  folder: string,
  depth: number,
  found: PackageFile[],
) {
  if (entry.isFile) {
    if (!wanted(entry.name)) return;
    const data = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    found.push({ path: folder + entry.name, data });
    return;
  }
  if (depth === 2) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns a directory in batches until an empty one.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (!batch.length) return;
    for (const child of batch)
      await collect(child, `${folder}${entry.name}/`, depth + 1, found);
  }
}
