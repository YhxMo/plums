import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  commonEnvelopeSchema,
  commonDeclarationSchema,
  commonPolicyDecisionSchema,
} from "../packages/sdk/dist/common-schema.js";
const destination = new URL("../docs/schemas/", import.meta.url);
await mkdir(destination, { recursive: true });
for (const [name, schema] of Object.entries({
  "common-envelope-1": commonEnvelopeSchema,
  "common-declaration-1": commonDeclarationSchema,
  "common-policy-decision-1": commonPolicyDecisionSchema,
})) {
  const target = new URL(`${name}.json`, destination);
  const encoded = JSON.stringify(schema, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if ((await readFile(target, "utf8")) !== encoded)
      throw Error(`Schema drift: ${name}`);
  } else await writeFile(target, encoded);
}
console.log(
  `Common schemas ${process.argv.includes("--check") ? "checked" : "written"}: ${fileURLToPath(destination)}`,
);
