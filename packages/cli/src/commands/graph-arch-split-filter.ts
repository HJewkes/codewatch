/**
 * A package is dropped from the split diagnostic when at least this share of its
 * clusters are singletons. Such a package has no real intra-package edge
 * structure to separate, so every "cluster" is an artifact — this floods the
 * genuinely-structured source packages with noise. A package with zero internal
 * edges degenerates to all-singletons (share 1.0) and is subsumed by this test.
 */
export const SPLIT_MAX_SINGLETON_SHARE = 0.9;

/**
 * Path segments that mark a directory as examples/docs/fixtures rather than a
 * real source package. `graph arch --split` skips any package whose id contains
 * one of these: they carry little intra-package structure, fragment into
 * all-singleton clusters, and drown the signal from actual source packages.
 */
const NON_SOURCE_SEGMENTS = new Set([
  "examples",
  "example",
  "docs",
  "www",
  "website",
  "fixtures",
  "__fixtures__",
  "e2e",
  "playground",
]);

/** A package is real source unless a path segment marks it examples/docs/etc. */
export function isSourcePackage(pkgId: string): boolean {
  return !pkgId.split("/").some((seg) => NON_SOURCE_SEGMENTS.has(seg));
}

/** True when the package's clusters are ~all singletons (no separable structure). */
export function isFragmented(
  clusters: readonly { files: readonly string[] }[],
): boolean {
  if (clusters.length === 0) return true;
  const singletons = clusters.filter((c) => c.files.length === 1).length;
  return singletons / clusters.length >= SPLIT_MAX_SINGLETON_SHARE;
}
