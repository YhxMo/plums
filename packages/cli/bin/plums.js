#!/usr/bin/env node
import { runCli } from "../dist/main.js";

const result = runCli(process.argv.slice(2));
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.exitCode);
