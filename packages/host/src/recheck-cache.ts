import { lstat, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Session } from "./host.js";

/** Only successful reads survive within one unchanged epoch. */
export class EpochMemo<T> {
  private token?: string;
  private generation = 0;
  private values = new Map<string, T>();
  private pending = new Map<string, Promise<T>>();
  private select(token: string) {
    if (this.token !== token) {
      this.token = token;
      this.generation++;
      this.values.clear();
      this.pending.clear();
    }
  }
  get(token: string, key: string): T | undefined {
    this.select(token);
    const value = this.values.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }
  set(token: string, key: string, value: T): void {
    this.select(token);
    this.values.set(key, structuredClone(value));
  }
  inflight(token: string, key: string, run: () => Promise<T>): Promise<T> {
    this.select(token);
    if (this.values.has(key)) return Promise.resolve(this.get(token, key)!);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const generation = this.generation;
    const pending = Promise.resolve()
      .then(run)
      .then((value) => {
        if (this.generation === generation)
          this.values.set(key, structuredClone(value));
        return value;
      })
      .finally(() => {
        if (this.generation === generation) this.pending.delete(key);
      });
    this.pending.set(key, pending);
    return pending;
  }
}

export class RequestRechecks {
  readonly foundation = new EpochMemo<boolean>();
  readonly authorization = new EpochMemo<{
    detail: Awaited<ReturnType<Session["core"]["getPackage"]>>;
    state: Awaited<ReturnType<Session["core"]["localAuthorizationState"]>>;
  }>();
}
const current = new AsyncLocalStorage<{
  epoch: RequestRechecks;
  full: boolean;
  tokens: WeakMap<Session, Promise<InstallationIdentity>>;
}>();
export const currentRecheck = () => current.getStore();
export function withRecheck<T>(
  epoch: RequestRechecks,
  full: boolean,
  run: () => Promise<T>,
): Promise<T> {
  return current.run({ epoch, full, tokens: new WeakMap() }, run);
}

/** Metadata is a change hint, not content verification. Complete rechecks still hash archives
 * and compare installed bytes, including after the allow audit. Never follow symlinks. */
export const INSTALLATION_METADATA_LIMIT = 4096;
async function installationMetadata(
  root: string,
): Promise<{ entries: unknown[]; overflow: boolean }> {
  const entries: [string, number, number, number][] = [];
  let visited = 0,
    count = 1,
    unavailable = false;
  const visit = async (relative: string): Promise<void> => {
    if (visited >= INSTALLATION_METADATA_LIMIT) return;
    visited++;
    const file = path.join(root, relative),
      stat = await lstat(file);
    entries.push([relative, stat.ino, stat.size, stat.mtimeMs]);
    if (stat.isDirectory()) {
      const names = await readdir(file);
      count += names.length;
      await Promise.all(
        names
          .slice(0, INSTALLATION_METADATA_LIMIT - visited)
          .map(async (name) => {
            try {
              await visit(path.join(relative, name));
            } catch {
              unavailable = true;
            }
          }),
      );
    }
  };
  try {
    await visit("");
  } catch {
    unavailable = true;
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const result: unknown[] = entries;
  if (unavailable) result.push(["unavailable"]);
  const overflow = count > INSTALLATION_METADATA_LIMIT;
  if (overflow) result.push(["overflow", count]);
  return { entries: result, overflow };
}
/** Store has no single write gate. Public dataDir fixes the documented packages/<id> layout.
 * Synchronous runtime checkpoints still detect cross-connection disable/enable ABA. */
interface InstallationIdentity {
  parts: unknown[];
  reusable: boolean;
}
async function readInstallationIdentity(
  s: Session,
): Promise<InstallationIdentity> {
  const [installed, state] = await Promise.all([
    s.core.listInstalled(),
    s.core.localAuthorizationState(),
  ]);
  const metadata = await Promise.all(
    (s.record.components ?? []).map(async (pin) => ({
      pin,
      metadata: await installationMetadata(
        path.join(s.core.dataDir, "packages", pin.packageId),
      ),
    })),
  );
  return {
    parts: [
      installed,
      state.revision,
      metadata.map(({ pin, metadata }) => [
        pin.packageId,
        pin.digest,
        metadata.entries,
      ]),
    ],
    reusable: !metadata.some((m) => m.metadata.overflow),
  };
}
/** One non-full checkpoint may read the same identity more than once. Share only
 * within that checkpoint; the next check and all full checks always read again. */
export async function installationToken(s: Session): Promise<string> {
  const scope = currentRecheck();
  let pending = scope && !scope.full ? scope.tokens.get(s) : undefined;
  if (!pending) {
    pending = readInstallationIdentity(s);
    if (scope && !scope.full) {
      scope.tokens.set(s, pending);
      void pending.catch(() => scope.tokens.delete(s));
    }
  }
  const identity = await pending;
  // Every overflow caller receives a different token, including coalesced readers.
  return JSON.stringify([
    ...identity.parts,
    ...(identity.reusable ? [] : [["uncached", randomUUID()]]),
  ]);
}
