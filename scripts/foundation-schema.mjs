import fs from "node:fs/promises";
import {
  foundationProviderSchema,
  foundationRequirementSchema,
  foundationSelectionSchema,
  foundationAgentSchema,
  foundationMessageSchema,
} from "../packages/sdk/dist/index.js";
const names = ["provider", "requirement", "selection", "agent", "message"];
const schemas = [
  foundationProviderSchema,
  foundationRequirementSchema,
  foundationSelectionSchema,
  foundationAgentSchema,
  foundationMessageSchema,
];
for (let i = 0; i < names.length; i++) {
  const file = `docs/schemas/foundation-${names[i]}-1.json`,
    text = JSON.stringify(schemas[i], null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if ((await fs.readFile(file, "utf8")) !== text)
      throw Error(`Schema differs: ${file}`);
  } else await fs.writeFile(file, text);
}
