import { expect, it } from "vitest";
import {
  droppedFiles,
  pickedFiles,
} from "../src/features/extensions/package-files";

/** A dropped file or folder, as webkitGetAsEntry describes it. */
type Fake = { name: string; children?: Fake[]; text?: string };
const entry = (fake: Fake): FileSystemEntry => {
  if (!fake.children)
    return {
      name: fake.name,
      isFile: true,
      isDirectory: false,
      file: (resolve: (file: File) => void) =>
        resolve(new File([fake.text ?? ""], fake.name)),
    } as unknown as FileSystemEntry;
  // Directories hand out their entries in batches until an empty one.
  const batches = [fake.children.slice(0, 1), fake.children.slice(1), []];
  return {
    name: fake.name,
    isFile: false,
    isDirectory: true,
    createReader: () => ({
      readEntries: (resolve: (entries: FileSystemEntry[]) => void) =>
        resolve((batches.shift() ?? []).map(entry)),
    }),
  } as unknown as FileSystemEntry;
};
const transfer = (...items: Fake[]) =>
  ({
    items: items.map((item) => ({ webkitGetAsEntry: () => entry(item) })),
    files: [],
  }) as unknown as DataTransfer;
const paths = (files: { path: string }[]) => files.map(({ path }) => path);

it("walks a dropped folder two levels deep for the package's two files", async () => {
  const dropped = await droppedFiles(
    transfer({
      name: "echo",
      children: [
        { name: "manifest.json", text: "{}" },
        { name: "README.md" },
        { name: "main.js" },
        {
          name: "src",
          children: [
            { name: "main.js" },
            { name: "deep", children: [{ name: "manifest.json" }] },
          ],
        },
      ],
    }),
  );
  expect(paths(dropped)).toEqual([
    "echo/manifest.json",
    "echo/main.js",
    "echo/src/main.js",
  ]);
  expect(await dropped[0].data.text()).toBe("{}");
});

it("keeps loose picked files by name and folder files by path", () => {
  const loose = [new File(["a"], "manifest.json"), new File(["b"], "main.js")];
  expect(paths(pickedFiles(loose) as { path: string }[])).toEqual([
    "manifest.json",
    "main.js",
  ]);
  const inFolder = (name: string) =>
    Object.defineProperty(new File([""], name), "webkitRelativePath", {
      value: `echo/${name}`,
    });
  expect(
    paths(
      pickedFiles([
        inFolder("manifest.json"),
        inFolder("logo.png"),
        inFolder("main.js"),
      ]) as { path: string }[],
    ),
  ).toEqual(["echo/manifest.json", "echo/main.js"]);
});
