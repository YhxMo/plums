import { lstatSync, readdirSync } from "node:fs";
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
}>();
export const currentRecheck = () => current.getStore();
export function withRecheck<T>(
  epoch: RequestRechecks,
  full: boolean,
  run: () => Promise<T>,
): Promise<T> {
  return current.run({ epoch, full }, run);
}

/** Metadata is a change hint, not content verification. Complete rechecks still hash archives
 * and compare installed bytes, including after the allow audit. Never follow symlinks. */
function installationMetadata(root: string): unknown[] {
  const entries: unknown[] = [];
  const visit = (relative: string) => {
    const file = path.join(root, relative),
      stat = lstatSync(file);
    entries.push([relative, stat.ino, stat.size, stat.mtimeMs]);
    if (stat.isDirectory())
      for (const name of readdirSync(file).sort())
        visit(path.join(relative, name));
  };
  try {
    visit("");
  } catch {
    entries.push(["unavailable"]);
  }
  return entries;
}
/** Store has no single write gate. Public dataDir fixes the documented packages/<id> layout.
 * Synchronous runtime checkpoints still detect cross-connection disable/enable ABA. */
export async function installationToken(s: Session): Promise<string> {
  const [installed, state] = await Promise.all([
    s.core.listInstalled(),
    s.core.localAuthorizationState(),
  ]);
  return JSON.stringify([
    installed,
    state.revision,
    (s.record.components ?? []).map((pin) => [
      pin.packageId,
      pin.digest,
      installationMetadata(
        path.join(s.core.dataDir, "packages", pin.packageId),
      ),
    ]),
  ]);
}
