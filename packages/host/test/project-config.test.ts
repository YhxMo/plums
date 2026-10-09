import { expect, it } from "vitest";
import {
  acceptable,
  collectConfiguration,
  renderConfiguration,
  type ReadConfig,
} from "../src/project-config.js";

it("copies only non-secret allowed fields from synthetic configuration", async () => {
  const data: Record<string, Record<string, string>> = {
    git: {
      "user.name": "Fixture",
      "user.email": "fixture@example.test",
      "alias.x": "!printf SECRET",
      "credential.helper": "SECRET",
      "include.path": "SECRET",
      "core.sshCommand": "SECRET",
    },
    npm: {
      registry: "https://packages.fixture.test/",
      "@s:registry": "https://user:SECRET@packages.fixture.test/",
      "//host/:_authToken": "SECRET",
      registry2: "https://host/?token=SECRET",
    },
  };
  const reader: ReadConfig = {
    fields: async (tool) => Object.keys(data[tool] ?? {}),
    read: async (tool, field) => data[tool]?.[field],
  };
  const items = await collectConfiguration(reader);
  expect(items).toEqual([
    { tool: "git", field: "user.email", value: "fixture@example.test" },
    { tool: "git", field: "user.name", value: "Fixture" },
    { tool: "npm", field: "registry", value: "https://packages.fixture.test/" },
  ]);
  const rendered = renderConfiguration(items);
  expect(rendered.gitconfig).toContain("Fixture");
  expect(rendered.npmrc).toBe("registry=https://packages.fixture.test/\n");
  expect(JSON.stringify({ items, rendered })).not.toMatch(
    /SECRET|alias|credential|include/,
  );
});
it.each([
  "https://user:password@host/",
  "https://host/?token=x",
  "https://host/?API_KEY=x",
  "https://host/?password=x",
  "https://host/\n_authToken=x",
])("rejects credentials and line injection: %s", (value) => {
  expect(acceptable("registry", value)).toBe(false);
});
it.each([
  "include.path",
  "alias.x",
  "credential.helper",
  "core.sshCommand",
  "core.hooksPath",
  "http.host.extraHeader",
  "url.host.insteadOf",
  "_authToken",
  "_password",
  "//host/:_authToken",
])("never renders the forbidden field %s", (field) => {
  expect(acceptable(field, "fixture")).toBe(false);
  expect(
    renderConfiguration([{ tool: "npm", field, value: "fixture" }]).npmrc,
  ).toBe("");
});
it("groups cargo and pip sections and preserves only allowed dynamic fields", async () => {
  const data: Record<string, Record<string, string>> = {
    cargo: {
      "source.mirror.registry": "https://mirror.test/",
      "source.mirror.replace-with": "other",
      "registries.test.index": "https://index.test/",
      "registries.test.token": "SECRET",
    },
    pip: {
      "global.index-url": "https://index.test/",
      "global.trusted-host": "index.test",
      "global.extra-index-url":
        "https://other.test/ https://user:SECRET@secret.test/",
    },
    npm: { "@scope:registry": "https://scope.test/" },
  };
  const items = await collectConfiguration({
    fields: async (tool) => Object.keys(data[tool] ?? {}),
    read: async (tool, field) => data[tool]?.[field],
  });
  const output = renderConfiguration(items);
  expect(output.cargoConfig.match(/\[source\."mirror"\]/g)).toHaveLength(1);
  expect(output.pipConf.match(/\[global\]/g)).toHaveLength(1);
  expect(output.npmrc).toBe("@scope:registry=https://scope.test/\n");
  expect(JSON.stringify({ items, output })).not.toContain("SECRET");
});
