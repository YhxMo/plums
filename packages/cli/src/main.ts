#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VERSION } from "@plums/core";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function runCli(args: readonly string[]): CliResult {
  if (args.length === 0 || args[0] === "version" || args[0] === "--version" || args[0] === "-v") {
    return { exitCode: 0, stdout: `${VERSION}\n`, stderr: "" };
  }
  return {
    exitCode: 1,
    stdout: "",
    stderr: `unknown command: ${args[0]}\n`,
  };
}

const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  const result = runCli(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}
