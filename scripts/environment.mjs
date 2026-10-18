import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, resolve } from "node:path";

export function projectEnvironment() {
  const cargoBin = resolve(homedir(), ".cargo/bin");
  return {
    ...process.env,
    PATH: existsSync(cargoBin)
      ? `${cargoBin}${delimiter}${process.env.PATH ?? ""}`
      : process.env.PATH,
    CARGO_HOME: process.env.CARGO_HOME ?? resolve(".cache/cargo"),
    PLUMS_DATA_DIR: resolve(".dev-data"),
  };
}
