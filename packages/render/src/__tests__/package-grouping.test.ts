import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { packageOf } from "@titan-design/graph-layout";
import { renderHtml } from "../template.js";
import type { RenderInput } from "../types.js";

interface NodeData {
  id: string;
  label: string;
  parent?: string;
}

const fileIds = [
  "apps/web/main.ts",
  "apps/web/src/page.ts",
  "apps/api/main.ts",
  "apps/api/src/route.ts",
  "products/shop/main.ts",
  "products/shop/src/cart.ts",
  "packages/core/index.ts",
  "packages/core/src/util.ts",
];

const snapshot: RenderInput = {
  snapshotId: 1,
  nodes: fileIds.map((id) => ({ id, kind: "file", name: id, role: "source" })),
  edges: [
    { srcId: "apps/web/src/page.ts", dstId: "packages/core/src/util.ts", kind: "imports" },
    { srcId: "apps/api/src/route.ts", dstId: "packages/core/src/util.ts", kind: "imports" },
    { srcId: "products/shop/src/cart.ts", dstId: "packages/core/index.ts", kind: "imports" },
  ],
};

function extractNodes(html: string): Map<string, NodeData> {
  const marker = "window.__GRAPH__ = ";
  const start = html.indexOf(marker) + marker.length;
  const raw = html.slice(start, html.indexOf(";</script>", start)).replace(/\\u003c/g, "<");
  const graph = JSON.parse(raw) as { nodes: Array<{ data: NodeData }> };
  return new Map(graph.nodes.map((n) => [n.data.id, n.data]));
}

function boxIds(nodes: Map<string, NodeData>): string[] {
  return [...nodes.keys()].filter((id) => /^(pkg|dir):/.test(id)).sort();
}

describe("package grouping across apps/, products/ and packages/", () => {
  it("boxes each app and product separately in the compound view", async () => {
    const nodes = extractNodes(await renderHtml(snapshot, { compound: true }));

    expect(boxIds(nodes)).toEqual([
      "pkg:apps/api",
      "pkg:apps/web",
      "pkg:core",
      "pkg:products/shop",
    ]);
    expect(nodes.get("pkg:apps/web")?.label).toBe("apps/web");
    for (const id of fileIds) {
      expect(nodes.get(id)?.parent, id).toBe(`pkg:${packageOf(id)}`);
    }
  });

  it("nests directory boxes under the app box, with none for the app root", async () => {
    const nodes = extractNodes(await renderHtml(snapshot, { compound: true, nested: true }));

    expect(nodes.get("apps/web/main.ts")?.parent).toBe("pkg:apps/web");
    expect(nodes.get("products/shop/main.ts")?.parent).toBe("pkg:products/shop");
    expect(nodes.get("apps/web/src/page.ts")?.parent).toBe("dir:apps/web/src");
    expect(nodes.get("dir:apps/web/src")?.parent).toBe("pkg:apps/web");
    expect(boxIds(nodes).filter((id) => id.startsWith("dir:"))).toEqual([
      "dir:apps/api/src",
      "dir:apps/web/src",
      "dir:packages/core/src",
      "dir:products/shop/src",
    ]);
  });
});

describe("client package colors", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
  });

  async function fileColors(html: string): Promise<Map<string, string>> {
    const page = await browser.newPage();
    try {
      await page.setContent(html);
      await page.waitForFunction(() => "__cy" in window, undefined, { timeout: 15000 });
      const entries = await page.evaluate((ids) => {
        const { __cy } = window as unknown as {
          __cy: { getElementById: (id: string) => { data: (k: string) => string } };
        };
        return ids.map((id): [string, string] => [id, __cy.getElementById(id).data("pkgColor")]);
      }, fileIds);
      return new Map(entries);
    } finally {
      await page.close();
    }
  }

  it("gives files one color per owning package, as packageOf groups them", async () => {
    const colors = await fileColors(await renderHtml(snapshot, { compound: true }));

    const colorByPackage = new Map(fileIds.map((id) => [packageOf(id), colors.get(id)]));
    for (const id of fileIds) {
      expect(colors.get(id), id).toBe(colorByPackage.get(packageOf(id)));
    }
    expect(new Set(colorByPackage.values()).size).toBe(colorByPackage.size);
  });
});
