import { expect, test } from "vitest";
import {
  VIEW_ICON_LIMIT,
  viewIconProblem,
  viewIconUrl,
} from "../modules/sdk/view-icon";
import { Host } from "../modules/extension-host/host";
import type { Platform } from "../modules/sdk";

const square =
  '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18"/></svg>';

test("an SVG with a viewBox within the size limit can be drawn", () => {
  expect(viewIconProblem(square)).toBeUndefined();
  expect(
    viewIconProblem(
      `<?xml version="1.0"?><!-- icon --><svg xmlns="http://www.w3.org/2000/svg" viewBox='0,0,24,24'><path d="M0 0h24v24z"/></svg>`,
    ),
  ).toBeUndefined();
});

test("non-SVG, missing or broken viewBox, oversized and non-string icons are refused", () => {
  for (const icon of [
    42,
    null,
    "",
    "<div>not an icon</div>",
    '<img src="x.svg">',
    "<svg><rect/></svg>",
    '<svg viewBox="0 0 24"><rect/></svg>',
    '<svg viewBox="a b c d"><rect/></svg>',
    '<svg viewBox="0 0 24 24"><rect/>',
    `<svg viewBox="0 0 24 24"><desc>${"x".repeat(VIEW_ICON_LIMIT)}</desc></svg>`,
  ])
    expect(viewIconProblem(icon), String(icon).slice(0, 40)).toBeTypeOf(
      "string",
    );
});

test("the mask URL is inert data with the SVG namespace added when missing", () => {
  const url = viewIconUrl(square);
  expect(url.startsWith('url("data:image/svg+xml,')).toBe(true);
  expect(decodeURIComponent(url.slice(24, -2))).toBe(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18"/></svg>',
  );
  // Quotes and markup are escaped, so the SVG cannot break out of the URL.
  expect(
    viewIconUrl('<svg viewBox="0 0 1 1"><text>")</text></svg>'),
  ).not.toMatch(/"\)<|<text/);
});

const platform: Platform = {
  kind: "browser",
  available: () => false,
  grant: async () => {},
  call: async () => {
    throw Error("No capabilities");
  },
};

test("views carry a valid icon, and an invalid one becomes a problem instead of failing the view", async () => {
  const host = new Host(platform);
  host.install({
    manifest: { id: "icons", version: "1", apiVersion: 1 },
    activate(ctx) {
      ctx.view({
        id: "good",
        label: "好",
        icon: square,
        mount: () => () => {},
      });
      ctx.view({
        id: "bad",
        label: "坏",
        icon: "<svg><rect/></svg>",
        mount: () => () => {},
      });
      ctx.view({ id: "plain", label: "无", mount: () => () => {} });
    },
  });
  await host.start("icons");
  const views = Object.fromEntries(host.views().map((view) => [view.id, view]));
  expect(views.good.icon).toBe(square);
  expect(views.good.iconProblem).toBeUndefined();
  expect(views.bad.icon).toBeUndefined();
  expect(views.bad.iconProblem).toMatch(/viewBox/);
  expect(views.plain).not.toHaveProperty("icon");
  expect(views.plain).not.toHaveProperty("iconProblem");
});
