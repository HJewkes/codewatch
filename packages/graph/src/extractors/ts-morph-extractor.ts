import * as path from "node:path";
import { existsSync } from "node:fs";
import {
  Project,
  ScriptTarget,
  ModuleKind,
  ModuleResolutionKind,
  type SourceFile,
} from "ts-morph";
import type { Extractor, ParsedFile } from "@codewatch/core";
import type { EdgeKind, GraphEdge, GraphFragment, GraphNode } from "../types.js";
import {
  externalId,
  fileId,
  moduleId,
  parentModuleId,
} from "./ids.js";

/**
 * Build the `file` + `module` nodes for a source file from its path alone.
 * Path-derived and deterministic, so the incremental indexer can reconstruct
 * an unchanged file's nodes without re-parsing it — they are byte-for-byte the
 * same nodes the extractor would emit. Keep this the single source of truth for
 * file/module node shape.
 */
export function buildFileModuleNodes(
  repoRoot: string,
  absPath: string,
): GraphNode[] {
  const fId = fileId(repoRoot, absPath);
  const mId = moduleId(repoRoot, absPath);
  const parentId = parentModuleId(mId) ?? undefined;
  return [
    {
      id: fId,
      kind: "file",
      name: path.basename(fId),
      parentId: mId,
      language: "typescript",
    },
    {
      id: mId,
      kind: "module",
      name: path.basename(mId),
      parentId,
      language: "typescript",
    },
  ];
}

export interface TsMorphGraphExtractorOptions {
  repoRoot: string;
  tsConfigPath?: string;
  project?: Project;
}

export class TsMorphGraphExtractor implements Extractor<GraphFragment> {
  readonly name = "ts-morph-graph";
  private readonly repoRoot: string;
  private readonly tsConfigPath?: string;
  private project?: Project;

  constructor(options: TsMorphGraphExtractorOptions) {
    this.repoRoot = options.repoRoot;
    this.tsConfigPath = options.tsConfigPath;
    this.project = options.project;
  }

  extract(file: ParsedFile): GraphFragment[] {
    if (!isTypeScriptFile(file)) return [];

    const project = this.ensureProject();
    const sourceFile = this.loadSourceFile(project, file);
    const nodes = this.buildFileAndModuleNodes(sourceFile);
    const { edges, externalNodes } = this.collectEdges(sourceFile);
    return [{ nodes: [...nodes, ...externalNodes], edges }];
  }

  private ensureProject(): Project {
    if (this.project) return this.project;
    this.project = this.tsConfigPath
      ? new Project({ tsConfigFilePath: this.tsConfigPath })
      : new Project({
          compilerOptions: {
            allowJs: true,
            target: ScriptTarget.ESNext,
            module: ModuleKind.ESNext,
            moduleResolution: ModuleResolutionKind.NodeNext,
          },
        });
    return this.project;
  }

  private loadSourceFile(project: Project, file: ParsedFile): SourceFile {
    const existing = project.getSourceFile(file.filePath);
    if (existing) {
      if (existing.getFullText() !== file.content) {
        existing.replaceWithText(file.content);
      }
      return existing;
    }
    return project.createSourceFile(file.filePath, file.content, {
      overwrite: true,
    });
  }

  private buildFileAndModuleNodes(sourceFile: SourceFile): GraphNode[] {
    return buildFileModuleNodes(this.repoRoot, sourceFile.getFilePath());
  }

  private collectEdges(sourceFile: SourceFile): {
    edges: GraphEdge[];
    externalNodes: GraphNode[];
  } {
    const srcAbs = sourceFile.getFilePath();
    const srcFileId = fileId(this.repoRoot, srcAbs);
    const edges: GraphEdge[] = [];
    const externalNodes: GraphNode[] = [];
    const seenExternals = new Set<string>();

    for (const decl of sourceFile.getImportDeclarations()) {
      this.handleSpecifier(
        srcAbs,
        srcFileId,
        decl.getModuleSpecifierValue(),
        decl.getModuleSpecifierSourceFile(),
        "imports",
        edges,
        externalNodes,
        seenExternals,
      );
    }

    for (const decl of sourceFile.getExportDeclarations()) {
      if (!decl.hasModuleSpecifier()) continue;
      this.handleSpecifier(
        srcAbs,
        srcFileId,
        decl.getModuleSpecifierValue(),
        decl.getModuleSpecifierSourceFile(),
        "re-exports",
        edges,
        externalNodes,
        seenExternals,
      );
    }

    return { edges, externalNodes };
  }

  private handleSpecifier(
    srcAbs: string,
    srcId: string,
    specifier: string | undefined,
    target: SourceFile | undefined,
    kind: EdgeKind,
    edges: GraphEdge[],
    externalNodes: GraphNode[],
    seenExternals: Set<string>,
  ): void {
    if (!specifier) return;
    const internal =
      this.resolveInternal(target) ??
      this.resolveRelativeInternal(srcAbs, specifier);
    if (internal) {
      edges.push({ srcId, dstId: internal, kind, attrs: { specifier } });
      return;
    }
    if (isRelativeSpecifier(specifier)) {
      // A relative import ts-morph could not resolve and that does not point at
      // a file on disk (e.g. an alias, or a genuinely missing target). Dropping
      // it is correct: bucketing it as an npm external produced `npm:..` junk
      // nodes and masked real internal edges for any out-of-project TS (C-44).
      return;
    }
    const extId = externalId(specifier);
    if (!seenExternals.has(extId)) {
      seenExternals.add(extId);
      externalNodes.push({
        id: extId,
        kind: "external",
        name: specifier,
      });
    }
    edges.push({ srcId, dstId: extId, kind, attrs: { specifier } });
  }

  private resolveInternal(target: SourceFile | undefined): string | null {
    if (!target) return null;
    return this.inRepoFileId(remapDistToSrc(target.getFilePath()));
  }

  /**
   * Resolve a relative specifier ts-morph failed to link by walking the
   * filesystem from the importing file. ts-morph's NodeNext resolution only
   * links relative imports that carry an explicit `.js` extension, so
   * extensionless bundler-style imports (`../types`, common in code outside the
   * tsconfig project such as `dashboard/`) resolve to nothing and would
   * otherwise fall through to the `npm:` external bucket (C-44). Resolves
   * through the ts-morph filesystem host so it honours in-memory test fixtures.
   */
  private resolveRelativeInternal(
    srcAbs: string,
    specifier: string,
  ): string | null {
    if (!isRelativeSpecifier(specifier)) return null;
    const fs = this.ensureProject().getFileSystem();
    const base = path.resolve(path.dirname(srcAbs), specifier);
    for (const candidate of relativeResolutionCandidates(base)) {
      if (fs.fileExistsSync(candidate)) {
        return this.inRepoFileId(candidate);
      }
    }
    return null;
  }

  private inRepoFileId(abs: string): string | null {
    const relative = path.relative(this.repoRoot, abs);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    if (relative.split(path.sep).includes("node_modules")) return null;
    return fileId(this.repoRoot, abs);
  }
}

const RESOLVABLE_EXTS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

function isRelativeSpecifier(specifier: string): boolean {
  return (
    specifier === "." ||
    specifier === ".." ||
    specifier.startsWith("./") ||
    specifier.startsWith("../")
  );
}

/**
 * Candidate on-disk paths for a resolved relative import base, in priority
 * order: an explicit extension already present, then the source extensions,
 * then a NodeNext `.js`→`.ts` remap, then `index.*` for directory imports.
 */
function* relativeResolutionCandidates(base: string): Iterable<string> {
  yield base;
  for (const ext of RESOLVABLE_EXTS) yield base + ext;
  const jsExt = /\.(?:jsx?|mjs|cjs)$/.exec(base);
  if (jsExt) {
    const stem = base.slice(0, base.length - jsExt[0].length);
    for (const ext of RESOLVABLE_EXTS) yield stem + ext;
  }
  for (const ext of RESOLVABLE_EXTS) yield path.join(base, "index" + ext);
}

// ts-morph resolves workspace imports like `@codewatch/analyzer` to the
// package's `types` entry (`<pkg>/dist/index.d.ts`), but the indexer's file
// walker excludes `dist/` and `.d.ts`. Without remapping, every cross-package
// edge points to a nonexistent node and the rendered graph fails to construct.
function remapDistToSrc(abs: string): string {
  const m = /^(.*)[\\/]dist[\\/](.+)\.d\.ts$/.exec(abs);
  if (!m) return abs;
  const base = m[1]!;
  const sub = m[2]!;
  for (const ext of [".ts", ".tsx"]) {
    const candidate = path.join(base, "src", sub + ext);
    if (existsSync(candidate)) return candidate;
  }
  return abs;
}

function isTypeScriptFile(file: ParsedFile): boolean {
  return file.language === "typescript" || file.language === "tsx";
}
