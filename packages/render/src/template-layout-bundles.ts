import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface LayoutBundles {
  layoutBase: string;
  coseBase: string;
  coseBilkent: string;
}

async function readPkg(pkg: string, file: string): Promise<string> {
  const path = require.resolve(`${pkg}/${file}`);
  return readFile(path, "utf8");
}

export async function loadLayoutBundles(): Promise<LayoutBundles> {
  const [layoutBase, coseBase, coseBilkent] = await Promise.all([
    readPkg("layout-base", "layout-base.js"),
    readPkg("cose-base", "cose-base.js"),
    readPkg("cytoscape-cose-bilkent", "cytoscape-cose-bilkent.js"),
  ]);
  return { layoutBase, coseBase, coseBilkent };
}
