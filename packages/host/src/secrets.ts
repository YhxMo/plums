import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SecretStore } from "@plums/core";
export interface SecretCipher {
  encrypt(value: string): Promise<string>;
  decrypt(value: string): Promise<string>;
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
