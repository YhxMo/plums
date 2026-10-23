import { readFileSync, statSync } from "node:fs";
import { extname, join, posix } from "node:path";

const types = {
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
};

/**
 * Development-server middleware serving `entries` of `root` (extensions/) at
 * the site root, untransformed, as a public directory would. Releases build
 * from public/ alone, so these files never reach dist/.
 * @param {string} root
 * @param {readonly string[]} entries top-level names under `root`
 * @returns {(req: {method?: string, url?: string}, res: any, next: () => void) => void}
 */
export function developmentFiles(root, entries) {
  return (req, res, next) => {
    let path;
    try {
      path = posix.normalize(
        decodeURIComponent(new URL(req.url ?? "/", "http://dev").pathname),
      );
    } catch {
      return next();
    }
    const [top] = path.slice(1).split("/");
    const type = types[/** @type {keyof typeof types} */ (extname(path))];
    if (req.method !== "GET" || !entries.includes(top) || !type) return next();
    const file = join(root, path);
    try {
      if (!statSync(file).isFile()) return next();
    } catch {
      return next();
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "no-cache");
    res.end(readFileSync(file));
  };
}
