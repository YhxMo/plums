import path from "node:path";
import { PlumsError } from "@plumsjs/core";

/** Trusted, canonical host paths. This profile alone is not an admission decision:
 * Seatbelt path filters do not exclude existing or subsequently added inode aliases. */
export interface ProjectProfileOptions {
  node: string;
  snapshot: string;
  projects: readonly string[];
  privateRoot: string;
  home: string;
  temporary: string;
  cache: string;
  userHome: string;
  dataDir: string;
  toolchains: readonly string[];
  readOnly: readonly string[];
  proxyPort?: number;
}

const system = [
  "/usr",
  "/bin",
  "/sbin",
  "/System",
  "/Library/Developer/CommandLineTools",
  "/opt/homebrew",
  "/usr/local",
  "/private/etc",
];
export const PROJECT_EXCLUDED = [
  ".ssh",
  "Library/Keychains",
  ".gnupg",
  ".npmrc",
  ".gitconfig",
  ".yarnrc.yml",
  ".yarnrc",
  ".config/pip",
  ".pip",
  ".cargo/config.toml",
  ".git-credentials",
  ".netrc",
  ".pypirc",
  ".cargo/credentials",
  ".cargo/credentials.toml",
  ".docker/config.json",
  ".aws",
  ".config/gh",
  ".kube",
];
const unavailable = () =>
  new PlumsError({
    code: "TIER_UNAVAILABLE",
    message: "项目档位的系统沙箱尚未就绪。",
  });
const within = (root: string, file: string) =>
  file === root || file.startsWith(root + path.sep);
const quote = (value: string): string => {
  if (
    typeof value !== "string" ||
    /[\x00-\x1f\x7f]/.test(value) ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value ||
    value === "/"
  )
    throw unavailable();
  return JSON.stringify(value);
};
const subpaths = (values: readonly string[]) =>
  [...new Set(values)].map((p) => `(subpath ${quote(p)})`).join(" ");

/** Kept separate from controlledProfile: project tools may fork, controlled commands may not. */
export function projectProfile(options: ProjectProfileOptions): string {
  const o = {
    ...options,
    projects: [...options.projects],
    toolchains: [...options.toolchains],
    readOnly: [...options.readOnly],
  };
  const writes = [...o.projects, o.home, o.temporary, o.cache];
  const reads = [
    ...system,
    o.snapshot,
    o.privateRoot,
    ...o.projects,
    ...o.toolchains,
    ...o.readOnly,
  ];
  for (const p of [...reads, ...writes, o.node, o.userHome, o.dataDir])
    quote(p);
  if (
    ![o.home, o.temporary, o.cache].every((p) => within(o.privateRoot, p)) ||
    !within(o.dataDir, o.privateRoot) ||
    o.privateRoot === o.dataDir ||
    o.snapshot === o.dataDir ||
    within(o.privateRoot, o.snapshot) ||
    within(o.snapshot, o.privateRoot) ||
    (o.proxyPort !== undefined &&
      (!Number.isInteger(o.proxyPort) ||
        o.proxyPort < 1 ||
        o.proxyPort > 65535))
  )
    throw unavailable();
  const parents = new Set<string>();
  const projectAncestors = new Set<string>();
  for (const project of o.projects) {
    let ancestor = project;
    while (ancestor !== "/") {
      projectAncestors.add(ancestor);
      ancestor = path.dirname(ancestor);
    }
  }
  for (const p of [...reads, o.node]) {
    let parent = path.dirname(p);
    while (parent !== "/") {
      parents.add(parent);
      parent = path.dirname(parent);
    }
  }
  return `(version 1)(deny default)
 (allow file-read* (literal "/") (literal ${quote(o.node)}) (literal "/dev/null") (literal "/dev/random") (literal "/dev/urandom") ${subpaths(reads)})
 (allow file-read-metadata ${[...parents].map((p) => `(literal ${quote(p)})`).join(" ")})
 (allow file-write* (literal "/dev/null") ${subpaths(writes)})
 (allow process-fork)
 (allow process-exec (literal ${quote(o.node)}) ${subpaths(reads)})
 (allow sysctl-read)(allow process-info* (target self))
 (allow signal (target same-sandbox))
 ${o.proxyPort === undefined ? "" : `(allow network-outbound (remote tcp4 "localhost:${o.proxyPort}"))`}
 (deny file-read* file-write* (require-all (subpath ${quote(o.dataDir)}) (require-not (subpath ${quote(o.privateRoot)})) (require-not (subpath ${quote(o.snapshot)}))))
 (deny file-write* ${subpaths([o.snapshot, ...o.toolchains])})
 (deny file-read* file-write* ${subpaths(PROJECT_EXCLUDED.map((p) => path.join(o.userHome, p)))})
 (deny process-exec (literal "/usr/bin/open") (literal "/bin/launchctl") (literal "/usr/bin/osascript") (literal "/usr/bin/sandbox-exec"))
 (allow file-link ${subpaths(o.projects)})
 (deny file-link (require-not (require-any ${subpaths(o.projects)})))
 (deny file-write-unlink ${[...projectAncestors].map((p) => `(literal ${quote(p)})`).join(" ")})
 (deny syscall-unix (syscall-number SYS_setsid SYS_setpgid))`;
}
