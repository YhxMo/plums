import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { SecretStore } from "@plums/core";
export interface SecretCipher {
  encrypt(value: string): Promise<string>;
  decrypt(value: string): Promise<string>;
}

const pendingLocal = new Map<string, Promise<unknown>>();
function serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const next = (pendingLocal.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(operation);
  pendingLocal.set(key, next);
  void next
    .finally(() => {
      if (pendingLocal.get(key) === next) pendingLocal.delete(key);
    })
    .catch(() => undefined);
  return next;
}

/** Local plaintext credentials, kept outside component settings and exports. */
export class LocalSecretStore implements SecretStore {
  constructor(
    private directory: string,
    private legacyFile?: string,
  ) {
    this.directory = path.resolve(directory);
    if (legacyFile) this.legacyFile = path.resolve(legacyFile);
  }
  private file(ref: string): string {
    return path.join(
      this.directory,
      createHash("sha256").update(ref).digest("hex"),
    );
  }
  private async checkDirectory(create: boolean): Promise<boolean> {
    if (create) await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const stat = await lstat(this.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error();
      if (process.platform !== "win32") await chmod(this.directory, 0o700);
      return true;
    } catch (error) {
      if (!create && (error as NodeJS.ErrnoException).code === "ENOENT")
        return false;
      throw error;
    }
  }
  async get(ref: string): Promise<string | undefined> {
    const file = this.file(ref);
    try {
      await pendingLocal.get(file)?.catch(() => undefined);
      if (!(await this.checkDirectory(false))) return undefined;
      const handle = await open(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        if (!(await handle.stat()).isFile()) throw Error();
        return await handle.readFile("utf8");
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw Error("Secret storage unavailable");
    }
  }
  set(ref: string, value: string): Promise<void> {
    const file = this.file(ref);
    return serial(file, async () => {
      const temporary = file + "." + randomUUID() + ".pending";
      try {
        await this.checkDirectory(true);
        await writeFile(temporary, value, { flag: "wx", mode: 0o600 });
        await rename(temporary, file);
      } catch {
        throw Error("Secret storage unavailable");
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
    });
  }
  delete(ref: string): Promise<void> {
    const file = this.file(ref);
    return serial(file, async () => {
      try {
        if (await this.checkDirectory(false)) await rm(file, { force: true });
        // Clean up an old ciphertext reference without asking the OS to decrypt it.
        // Desktop's single-instance lock also serializes legacy cleanup across processes.
        if (this.legacyFile)
          await serial(this.legacyFile, async () => {
            try {
              await lstat(this.legacyFile!);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
              throw error;
            }
            await new EncryptedSecretStore(this.legacyFile!, {
              async encrypt() {
                throw Error();
              },
              async decrypt() {
                throw Error();
              },
            }).delete(ref);
          });
      } catch {
        throw Error("Secret storage unavailable");
      }
    });
  }
}
/** All disk values are ciphertext. Each agent owns a separate store and queue. */
export class EncryptedSecretStore implements SecretStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private file: string,
    private cipher: SecretCipher,
  ) {}
  private async read(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as Record<
        string,
        string
      >;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw Error("Secret storage unavailable");
    }
  }
  async get(ref: string): Promise<string | undefined> {
    await this.queue;
    const values = await this.read();
    if (!Object.hasOwn(values, ref)) return undefined;
    try {
      return await this.cipher.decrypt(values[ref]!);
    } catch {
      throw Error("Secret storage unavailable");
    }
  }
  private change(ref: string, value?: string): Promise<void> {
    const next = this.queue.then(async () => {
      const values = await this.read();
      if (value === undefined) delete values[ref];
      else values[ref] = await this.cipher.encrypt(value);
      await mkdir(path.dirname(this.file), { recursive: true });
      const temp = this.file + ".pending";
      await writeFile(temp, JSON.stringify(values), { mode: 0o600 });
      await rename(temp, this.file);
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
  set(ref: string, value: string): Promise<void> {
    return this.change(ref, value);
  }
  delete(ref: string): Promise<void> {
    return this.change(ref);
  }
}
