import {
  computePartitionQuality,
  patternToRegex,
} from "@codewatch/graph";
import { bucketFilesByPackage } from "./graph-wiki-packages.js";
import {
  aggregateEdges,
  filteredFileIds,
  packagesReferencedByEdges,
  toSortedEdges,
  type ComputeArchInput,
} from "./graph-arch-compute.js";
import { detectCommunities } from "./graph-arch-community.js";
import type { ArchPackage, ArchResult } from "./graph-arch.js";

/** One domain: a display name and the path globs whose files belong to it. */
export interface DomainDef {
  name: string;
  patterns: string[];
}

/** Warnings surfaced when validating a domains config against the file set. */
export interface DomainValidation {
  /** Domains whose globs matched no files. */
  emptyDomains: string[];
  /** Individual globs that matched no files, as "domain: glob". */
  emptyPatterns: string[];
  /** Files matched by more than one domain (assigned to the first, in config order). */
  overlaps: Array<{ file: string; domains: string[] }>;
  /** Count of indexed files matched by no domain. */
  unassignedFiles: number;
}

/** Newman-Girvan Q for each candidate partition of the same dependency graph. */
export interface PartitionFit {
  domainQ: number;
  packageQ: number;
  /** Q of the greedy-modularity community partition (the achievable ceiling). */
  detectedQ: number;
  detectedCommunities: number;
}

/**
 * Parse a JSON domains config: `{ "domains": { "<name>": "<glob>" | ["<glob>", ...] } }`.
 * YAML is intentionally unsupported — no YAML dependency exists in the repo and
 * this is a low-priority command, so a heavy dep isn't justified. Domain order
 * follows the JSON key order (drives deterministic first-match on overlap).
 */
export function parseDomainConfig(raw: string): DomainDef[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid domains config JSON: ${(err as Error).message}`);
  }
  const domainsObj = (parsed as { domains?: unknown } | null)?.domains;
  if (!domainsObj || typeof domainsObj !== "object" || Array.isArray(domainsObj)) {
    throw new Error('Domains config must have a "domains" object mapping names to path globs.');
  }
  const defs = Object.entries(domainsObj as Record<string, unknown>).map(
    ([name, value]) => ({ name, patterns: toPatternList(name, value) }),
  );
  if (defs.length === 0) throw new Error("Domains config defines no domains.");
  return defs;
}

function toPatternList(name: string, value: unknown): string[] {
  const list =
    typeof value === "string"
      ? [value]
      : Array.isArray(value) && value.every((v) => typeof v === "string")
        ? (value as string[])
        : null;
  if (!list || list.length === 0) {
    throw new Error(`Domain "${name}" must map to a glob string or a non-empty array of glob strings.`);
  }
  return list;
}

/**
 * Aggregate the architecture diagram at explicit-domain level (from a config)
 * instead of package level, and compare how well the domain partition fits the
 * dependency graph against the package layout and a greedy-modularity
 * community detection.
 */
export function computeArchDomains(
  input: ComputeArchInput,
  domains: DomainDef[],
): ArchResult {
  const fileIds = filteredFileIds(input.nodes, input);
  const fileByPackage = bucketFilesByPackage(fileIds, input.packages);
  const assignment = assignDomains(fileIds, domains);
  const counts = aggregateEdges(
    input.edges,
    assignment.domainByFile,
    assignment.domainByFile,
    new Set<string>(),
    false,
  );
  const minEdges = Math.max(1, input.minEdges ?? 1);
  return {
    snapshot: input.snapshot,
    packages: buildDomainNodes(domains, assignment.fileByDomain, counts),
    edges: toSortedEdges(counts, minEdges),
    includesExternal: false,
    domainValidation: assignment.validation,
    partitionFit: computePartitionFit(
      input,
      fileByPackage,
      assignment.fileByDomain,
      fileIds,
    ),
  };
}

interface DomainAssignment {
  fileByDomain: Map<string, string[]>;
  domainByFile: Map<string, string>;
  validation: DomainValidation;
}

/** Assign each file to the first domain (config order) whose globs match it. */
function assignDomains(
  fileIds: readonly string[],
  domains: readonly DomainDef[],
): DomainAssignment {
  const compiled = domains.map((d) => ({
    name: d.name,
    patterns: d.patterns.map((glob) => ({ glob, rx: patternToRegex(glob) })),
  }));
  const fileByDomain = new Map<string, string[]>();
  const domainByFile = new Map<string, string>();
  const overlaps: Array<{ file: string; domains: string[] }> = [];
  const hitPatterns = new Set<string>();
  let unassignedFiles = 0;
  for (const file of fileIds) {
    const matched = matchDomains(file, compiled, hitPatterns);
    if (matched.length === 0) {
      unassignedFiles += 1;
      continue;
    }
    if (matched.length > 1) overlaps.push({ file, domains: matched });
    domainByFile.set(file, matched[0]);
    pushMulti(fileByDomain, matched[0], file);
  }
  const validation = buildValidation(
    domains,
    fileByDomain,
    hitPatterns,
    overlaps,
    unassignedFiles,
  );
  return { fileByDomain, domainByFile, validation };
}

interface CompiledDomain {
  name: string;
  patterns: Array<{ glob: string; rx: RegExp }>;
}

function matchDomains(
  file: string,
  compiled: readonly CompiledDomain[],
  hitPatterns: Set<string>,
): string[] {
  const names: string[] = [];
  for (const d of compiled) {
    let matched = false;
    for (const p of d.patterns) {
      if (!p.rx.test(file)) continue;
      hitPatterns.add(patternKey(d.name, p.glob));
      matched = true;
    }
    if (matched) names.push(d.name);
  }
  return names;
}

function buildValidation(
  domains: readonly DomainDef[],
  fileByDomain: ReadonlyMap<string, string[]>,
  hitPatterns: ReadonlySet<string>,
  overlaps: Array<{ file: string; domains: string[] }>,
  unassignedFiles: number,
): DomainValidation {
  const emptyDomains = domains
    .filter((d) => !fileByDomain.has(d.name))
    .map((d) => d.name);
  const emptyPatterns: string[] = [];
  for (const d of domains) {
    for (const glob of d.patterns) {
      if (!hitPatterns.has(patternKey(d.name, glob))) {
        emptyPatterns.push(`${d.name}: ${glob}`);
      }
    }
  }
  return { emptyDomains, emptyPatterns, overlaps, unassignedFiles };
}

function patternKey(domain: string, glob: string): string {
  return `${domain} ${glob}`;
}

function buildDomainNodes(
  domains: readonly DomainDef[],
  fileByDomain: ReadonlyMap<string, string[]>,
  counts: ReadonlyMap<string, ReadonlyMap<string, number>>,
): ArchPackage[] {
  const referenced = packagesReferencedByEdges(counts);
  const out: ArchPackage[] = [];
  for (const d of domains) {
    const files = fileByDomain.get(d.name)?.length ?? 0;
    if (files === 0 && !referenced.has(d.name)) continue;
    out.push({ id: d.name, name: d.name, files });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function computePartitionFit(
  input: ComputeArchInput,
  fileByPackage: ReadonlyMap<string, ReadonlyArray<string>>,
  fileByDomain: ReadonlyMap<string, ReadonlyArray<string>>,
  fileIds: readonly string[],
): PartitionFit {
  const detected = detectCommunities(fileIds, input.edges);
  return {
    domainQ: partitionQ(input, fileByDomain),
    packageQ: partitionQ(input, fileByPackage),
    detectedQ: partitionQ(input, detected),
    detectedCommunities: detected.size,
  };
}

function partitionQ(
  input: ComputeArchInput,
  fileByBucket: ReadonlyMap<string, ReadonlyArray<string>>,
): number {
  const packages = [...fileByBucket.keys()]
    .filter((id) => id !== "")
    .map((id) => ({ id }));
  return computePartitionQuality({
    packages,
    fileByPackage: fileByBucket,
    nodes: input.nodes,
    edges: input.edges,
  }).modularityQ;
}

function pushMulti<K>(map: Map<K, string[]>, key: K, value: string): void {
  let list = map.get(key);
  if (!list) {
    list = [];
    map.set(key, list);
  }
  list.push(value);
}
