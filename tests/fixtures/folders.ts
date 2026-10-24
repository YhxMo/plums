import { readFileSync } from "node:fs";
import { loadExtension } from "../../modules/extension-host/definition";

/**
 * Loads an extension folder from the repository in Node, through the same
 * loader the app uses for folders it serves; only manifest.json is read from
 * disk instead of fetched.
 */
export const loadFolder = (folder: string, expectedId?: string) =>
  loadExtension(new URL(`../../${folder}/`, import.meta.url).href, expectedId, {
    read: async (url) => JSON.parse(readFileSync(new URL(url), "utf8")),
  });
