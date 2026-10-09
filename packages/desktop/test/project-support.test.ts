import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ProjectSupport } from "../src/components/ProjectSupport.js";
import type { TierPlan } from "@plums/host";

it("shows actual project support data without a path input or a runnable project claim", () => {
  const entries: TierPlan["entries"] = [
    {
      packageId: "fixture",
      name: "Fixture",
      formatVersion: "2.0",
      confirmed: false,
      permissions: [],
      engines: [
        {
          engineId: "local",
          tier: "project",
          hosts: ["packages.fixture.test"],
          state: "pending",
          toolchains: [
            {
              name: "node",
              root: "/fixture/tools/node/v1",
              executable: "/fixture/tools/node/v1/bin/node",
              found: true,
            },
            {
              name: "git",
              root: "",
              executable: "",
              found: false,
              reason: "NOT_FOUND",
            },
          ],
          credentials: [],
          configuration: [
            { tool: "git", field: "user.name", value: "Fixture User" },
          ],
        },
      ],
    },
  ];
  const html = renderToStaticMarkup(
    createElement(ProjectSupport, {
      entries,
      cache: [{ packageId: "fixture", bytes: 1234, files: 2 }],
      clear: () => {},
    }),
  );
  expect(html).toContain("/fixture/tools/node/v1");
  expect(html).toContain("未找到（可稍后重新探测）");
  expect(html).toContain("git.user.name");
  expect(html).toContain("Fixture User");
  expect(html).toContain("1234");
  expect(html).toContain("清空缓存");
  expect(html).toContain("packages.fixture.test");
  expect(html).not.toContain("<input");
  expect(html).toContain("项目启动当前不可用");
  expect(html).toContain("不是内核级");
});
