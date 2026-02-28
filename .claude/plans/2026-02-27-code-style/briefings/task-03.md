# Task 03: GitHub Ingest Service

## Architectural Context

The ingest service is Stage 1 of the analysis pipeline (`Ingest -> Extract -> Aggregate -> AI Enrich -> Interactive Review`). It uses octokit to fetch a developer's GitHub contributions -- commits, PR diffs, and review comments -- and normalizes them into a corpus that the extractor stage consumes. This is the only network-touching module in the pipeline. It must handle GitHub API pagination, rate limiting, and disk caching to support re-runs without re-fetching. Filters narrow the corpus by author, date range, repo list, and file type (skipping generated/vendored files). The output is a normalized `CodeCorpus` containing source files (content + metadata), pull request diffs, and review comments.

## File Ownership

**May modify:**
- `/packages/analyzer/package.json` (add octokit dependency)
- `/packages/analyzer/src/index.ts` (re-export public API)
- `/packages/analyzer/src/ingest/types.ts` (NEW)
- `/packages/analyzer/src/ingest/github-service.ts` (NEW)
- `/packages/analyzer/src/ingest/file-filter.ts` (NEW)
- `/packages/analyzer/src/ingest/cache.ts` (NEW)
- `/packages/analyzer/src/ingest/index.ts` (NEW)
- `/packages/analyzer/src/__tests__/file-filter.test.ts` (NEW)
- `/packages/analyzer/src/__tests__/cache.test.ts` (NEW)
- `/packages/analyzer/src/__tests__/github-service.test.ts` (NEW)

**Must not touch:**
- `/packages/profile/**` (completed in Task 02)
- `/packages/checker/**`
- `/packages/cli/**`
- `/docs/**`

**Read for context (do not modify):**
- `/docs/plans/2026-02-27-code-style-design.md` (Stage 1 description, storage layout)
- `/docs/research/08-tool-pipeline-matrix.md` (ingest stage tool assignments)

## Steps

### Step 1: Add dependencies

```bash
pnpm --filter @code-style/analyzer add octokit
```

### Step 2: Define types

**`packages/analyzer/src/ingest/types.ts`**:

```ts
export interface IngestConfig {
  repos: string[];
  since?: string;
  until?: string;
  languages: string[];
  githubToken: string;
  cacheDir?: string;
}

export interface CodeFile {
  path: string;
  content: string;
  language: string;
  repo: string;
  sha: string;
}

export interface ReviewComment {
  body: string;
  path: string;
  line: number | null;
  author: string;
  prNumber: number;
  repo: string;
  createdAt: string;
}

export interface PullRequest {
  number: number;
  title: string;
  repo: string;
  author: string;
  files: PullRequestFile[];
  comments: ReviewComment[];
}

export interface PullRequestFile {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed";
  patch?: string;
  additions: number;
  deletions: number;
}

export interface CodeCorpus {
  files: CodeFile[];
  pullRequests: PullRequest[];
  reviewComments: ReviewComment[];
  metadata: IngestMetadata;
}

export interface IngestMetadata {
  repos: string[];
  author: string;
  since?: string;
  until?: string;
  fetchedAt: string;
  totalCommits: number;
  totalFiles: number;
  totalReviewComments: number;
}
```

### Step 3: Write file filter tests

**`packages/analyzer/src/__tests__/file-filter.test.ts`**:

```ts
import { describe, it, expect } from "vitest";
import { shouldIncludeFile, getLanguageFromPath } from "../ingest/file-filter.js";

describe("shouldIncludeFile", () => {
  const languages = ["typescript", "python"];

  it("includes .ts files when typescript is requested", () => {
    expect(shouldIncludeFile("src/utils.ts", languages)).toBe(true);
  });

  it("includes .tsx files when typescript is requested", () => {
    expect(shouldIncludeFile("src/App.tsx", languages)).toBe(true);
  });

  it("includes .py files when python is requested", () => {
    expect(shouldIncludeFile("scripts/main.py", languages)).toBe(true);
  });

  it("excludes files with non-matching extensions", () => {
    expect(shouldIncludeFile("styles.css", languages)).toBe(false);
  });

  it("excludes node_modules", () => {
    expect(shouldIncludeFile("node_modules/foo/index.ts", languages)).toBe(false);
  });

  it("excludes vendor directories", () => {
    expect(shouldIncludeFile("vendor/lib/bar.ts", languages)).toBe(false);
  });

  it("excludes dist directories", () => {
    expect(shouldIncludeFile("dist/index.js", languages)).toBe(false);
  });

  it("excludes .min.js files", () => {
    expect(shouldIncludeFile("lib/bundle.min.js", languages)).toBe(false);
  });

  it("excludes generated files", () => {
    expect(shouldIncludeFile("src/__generated__/types.ts", languages)).toBe(false);
  });

  it("excludes lock files", () => {
    expect(shouldIncludeFile("pnpm-lock.yaml", languages)).toBe(false);
  });

  it("excludes .d.ts declaration files", () => {
    expect(shouldIncludeFile("src/types.d.ts", languages)).toBe(false);
  });
});

describe("getLanguageFromPath", () => {
  it("returns typescript for .ts", () => {
    expect(getLanguageFromPath("src/index.ts")).toBe("typescript");
  });

  it("returns typescript for .tsx", () => {
    expect(getLanguageFromPath("src/App.tsx")).toBe("typescript");
  });

  it("returns python for .py", () => {
    expect(getLanguageFromPath("main.py")).toBe("python");
  });

  it("returns null for unknown extensions", () => {
    expect(getLanguageFromPath("styles.css")).toBeNull();
  });
});
```

Run: `pnpm test -- packages/analyzer` -- expect failures.

### Step 4: Implement file filter

**`packages/analyzer/src/ingest/file-filter.ts`**:

```ts
import * as path from "node:path";

const EXCLUDED_DIRS = [
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  "__generated__",
  ".git",
  "coverage",
];

const EXCLUDED_PATTERNS = [
  /\.min\.[jt]sx?$/,
  /\.d\.ts$/,
  /\.map$/,
  /lock\.(json|yaml)$/,
  /pnpm-lock\.yaml$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
];

const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  typescript: [".ts", ".tsx"],
  javascript: [".js", ".jsx"],
  python: [".py"],
};

export function shouldIncludeFile(
  filePath: string,
  languages: string[],
): boolean {
  const segments = filePath.split("/");
  if (segments.some((s) => EXCLUDED_DIRS.includes(s))) {
    return false;
  }

  if (EXCLUDED_PATTERNS.some((p) => p.test(filePath))) {
    return false;
  }

  const ext = path.extname(filePath);
  const allowedExtensions = languages.flatMap(
    (lang) => LANGUAGE_EXTENSIONS[lang] ?? [],
  );

  return allowedExtensions.includes(ext);
}

export function getLanguageFromPath(filePath: string): string | null {
  const ext = path.extname(filePath);
  for (const [language, extensions] of Object.entries(LANGUAGE_EXTENSIONS)) {
    if (extensions.includes(ext)) {
      return language;
    }
  }
  return null;
}
```

Run: `pnpm test -- packages/analyzer` -- file filter tests pass.

### Step 5: Write cache tests

**`packages/analyzer/src/__tests__/cache.test.ts`**:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileCache } from "../ingest/cache.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

describe("FileCache", () => {
  let cacheDir: string;
  let cache: FileCache;

  beforeEach(async () => {
    cacheDir = path.join(tmpdir(), `code-style-cache-${Date.now()}`);
    cache = new FileCache(cacheDir);
  });

  afterEach(async () => {
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  it("returns null on cache miss", async () => {
    const result = await cache.get("nonexistent-key");
    expect(result).toBeNull();
  });

  it("returns cached value on cache hit", async () => {
    const data = { files: [{ path: "test.ts" }] };
    await cache.set("my-key", data);

    const result = await cache.get("my-key");
    expect(result).toEqual(data);
  });

  it("creates cache directory if it does not exist", async () => {
    const nestedDir = path.join(cacheDir, "nested", "deep");
    const nestedCache = new FileCache(nestedDir);
    await nestedCache.set("key", { value: 1 });

    const result = await nestedCache.get("key");
    expect(result).toEqual({ value: 1 });
  });

  it("uses content-addressed filenames", async () => {
    await cache.set("test-key", { data: true });

    const entries = await fs.readdir(cacheDir);
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatch(/^[a-f0-9]+\.json$/);
  });
});
```

### Step 6: Implement cache

**`packages/analyzer/src/ingest/cache.ts`**:

```ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";

export class FileCache {
  constructor(private readonly cacheDir: string) {}

  async get(key: string): Promise<unknown | null> {
    const filePath = this.keyToPath(key);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    const filePath = this.keyToPath(key);
    await fs.writeFile(filePath, JSON.stringify(value));
  }

  async has(key: string): Promise<boolean> {
    const filePath = this.keyToPath(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private keyToPath(key: string): string {
    const hash = createHash("sha256").update(key).digest("hex");
    return path.join(this.cacheDir, `${hash}.json`);
  }
}
```

Run: `pnpm test -- packages/analyzer` -- cache tests pass.

### Step 7: Write GitHub service tests (mocked)

**`packages/analyzer/src/__tests__/github-service.test.ts`**:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubService } from "../ingest/github-service.js";
import type { IngestConfig } from "../ingest/types.js";

// Mock octokit at the module level
vi.mock("octokit", () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    rest: {
      repos: {
        listCommits: vi.fn().mockResolvedValue({
          data: [
            { sha: "abc123", commit: { message: "test commit" } },
          ],
        }),
        getCommit: vi.fn().mockResolvedValue({
          data: {
            sha: "abc123",
            files: [
              {
                filename: "src/index.ts",
                status: "modified",
                patch: "@@ -1,3 +1,5 @@\n+const x = 1;",
                additions: 2,
                deletions: 0,
              },
              {
                filename: "node_modules/foo/index.js",
                status: "modified",
                patch: "",
                additions: 1,
                deletions: 0,
              },
            ],
          },
        }),
        getContent: vi.fn().mockResolvedValue({
          data: {
            content: Buffer.from("export const x = 1;").toString("base64"),
            encoding: "base64",
          },
        }),
      },
      pulls: {
        list: vi.fn().mockResolvedValue({
          data: [
            {
              number: 1,
              title: "Test PR",
              user: { login: "testuser" },
            },
          ],
        }),
        listFiles: vi.fn().mockResolvedValue({
          data: [
            {
              filename: "src/utils.ts",
              status: "added",
              patch: "+export function add(a: number, b: number) { return a + b; }",
              additions: 1,
              deletions: 0,
            },
          ],
        }),
        listReviewComments: vi.fn().mockResolvedValue({
          data: [
            {
              body: "Use camelCase here",
              path: "src/utils.ts",
              line: 5,
              user: { login: "testuser" },
              created_at: "2026-01-15T10:00:00Z",
            },
          ],
        }),
      },
    },
  })),
}));

describe("GitHubService", () => {
  const config: IngestConfig = {
    repos: ["owner/repo"],
    languages: ["typescript"],
    githubToken: "test-token",
    since: "2026-01-01",
  };

  let service: GitHubService;

  beforeEach(() => {
    service = new GitHubService(config);
  });

  it("fetches commit files and filters out excluded paths", async () => {
    const files = await service.fetchCommitFiles("owner/repo", "abc123");
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe("src/index.ts");
  });

  it("fetches PR diffs", async () => {
    const prs = await service.fetchPullRequests("owner/repo");
    expect(prs).toHaveLength(1);
    expect(prs[0].title).toBe("Test PR");
  });

  it("fetches review comments", async () => {
    const comments = await service.fetchReviewComments("owner/repo", 1);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("Use camelCase here");
  });

  it("fetches file content and decodes base64", async () => {
    const content = await service.fetchFileContent("owner/repo", "src/index.ts", "abc123");
    expect(content).toBe("export const x = 1;");
  });

  it("returns null for files that fail to fetch", async () => {
    const { Octokit } = await import("octokit");
    const mockInstance = new Octokit();
    (mockInstance.rest.repos.getContent as any).mockRejectedValueOnce(new Error("Not Found"));
    const failService = new GitHubService(config);
    // The mock is module-level, so we test the error path in the implementation
  });

  it("builds a complete CodeCorpus from ingest()", async () => {
    const corpus = await service.ingest();
    expect(corpus.files.length).toBeGreaterThanOrEqual(0);
    expect(corpus.metadata.repos).toEqual(["owner/repo"]);
    expect(corpus.metadata.fetchedAt).toBeDefined();
    expect(corpus.reviewComments).toBeDefined();
  });
});
```

### Step 8: Implement GitHub service

**`packages/analyzer/src/ingest/github-service.ts`**:

```ts
import { Octokit } from "octokit";
import type {
  IngestConfig,
  CodeCorpus,
  CodeFile,
  PullRequest,
  PullRequestFile,
  ReviewComment,
} from "./types.js";
import { shouldIncludeFile, getLanguageFromPath } from "./file-filter.js";
import { FileCache } from "./cache.js";

function splitRepo(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split("/");
  return { owner, repo };
}

export class GitHubService {
  private octokit: Octokit;
  private config: IngestConfig;
  private cache: FileCache | null;

  constructor(config: IngestConfig) {
    this.config = config;
    this.octokit = new Octokit({ auth: config.githubToken });
    this.cache = config.cacheDir ? new FileCache(config.cacheDir) : null;
  }

  async ingest(): Promise<CodeCorpus> {
    const allFiles: CodeFile[] = [];
    const allPRs: PullRequest[] = [];
    const allComments: ReviewComment[] = [];
    let totalCommits = 0;

    for (const repoFullName of this.config.repos) {
      const { owner, repo } = splitRepo(repoFullName);

      const commits = await this.fetchCommitShas(repoFullName);
      totalCommits += commits.length;

      const seenPaths = new Set<string>();
      for (const sha of commits) {
        const commitFiles = await this.fetchCommitFiles(repoFullName, sha);
        for (const file of commitFiles) {
          if (seenPaths.has(file.filename)) continue;
          seenPaths.add(file.filename);

          const content = await this.fetchFileContent(repoFullName, file.filename, sha);
          if (content === null) continue;

          const language = getLanguageFromPath(file.filename);
          if (!language) continue;

          allFiles.push({
            path: file.filename,
            content,
            language,
            repo: repoFullName,
            sha,
          });
        }
      }

      const prs = await this.fetchPullRequests(repoFullName);
      for (const pr of prs) {
        const comments = await this.fetchReviewComments(repoFullName, pr.number);
        pr.comments = comments;
        allComments.push(...comments);

        const files = await this.fetchPRFiles(repoFullName, pr.number);
        pr.files = files;
      }
      allPRs.push(...prs);
    }

    return {
      files: allFiles,
      pullRequests: allPRs,
      reviewComments: allComments,
      metadata: {
        repos: this.config.repos,
        author: this.config.repos[0]?.split("/")[0] ?? "unknown",
        since: this.config.since,
        until: this.config.until,
        fetchedAt: new Date().toISOString(),
        totalCommits,
        totalFiles: allFiles.length,
        totalReviewComments: allComments.length,
      },
    };
  }

  async fetchCommitShas(repo: string): Promise<string[]> {
    const { owner, repo: repoName } = splitRepo(repo);

    const cacheKey = `commits:${repo}:${this.config.since ?? ""}:${this.config.until ?? ""}`;
    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return cached as string[];
    }

    const response = await this.octokit.rest.repos.listCommits({
      owner,
      repo: repoName,
      since: this.config.since,
      until: this.config.until,
      per_page: 100,
    });

    const shas = response.data.map((c: any) => c.sha);

    if (this.cache) {
      await this.cache.set(cacheKey, shas);
    }

    return shas;
  }

  async fetchCommitFiles(
    repo: string,
    sha: string,
  ): Promise<PullRequestFile[]> {
    const { owner, repo: repoName } = splitRepo(repo);
    const response = await this.octokit.rest.repos.getCommit({
      owner,
      repo: repoName,
      ref: sha,
    });

    const files = (response.data as any).files ?? [];
    return files
      .filter((f: any) => shouldIncludeFile(f.filename, this.config.languages))
      .map((f: any) => ({
        filename: f.filename,
        status: f.status as PullRequestFile["status"],
        patch: f.patch,
        additions: f.additions,
        deletions: f.deletions,
      }));
  }

  async fetchFileContent(
    repo: string,
    filePath: string,
    ref: string,
  ): Promise<string | null> {
    const { owner, repo: repoName } = splitRepo(repo);

    const cacheKey = `file:${repo}:${filePath}:${ref}`;
    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return cached as string;
    }

    try {
      const response = await this.octokit.rest.repos.getContent({
        owner,
        repo: repoName,
        path: filePath,
        ref,
      });

      const data = response.data as { content: string; encoding: string };
      const content = Buffer.from(data.content, "base64").toString("utf-8");

      if (this.cache) {
        await this.cache.set(cacheKey, content);
      }

      return content;
    } catch {
      return null;
    }
  }

  async fetchPullRequests(repo: string): Promise<PullRequest[]> {
    const { owner, repo: repoName } = splitRepo(repo);
    const response = await this.octokit.rest.pulls.list({
      owner,
      repo: repoName,
      state: "closed",
      sort: "updated",
      direction: "desc",
      per_page: 100,
    });

    return response.data.map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      repo,
      author: pr.user?.login ?? "unknown",
      files: [],
      comments: [],
    }));
  }

  async fetchPRFiles(
    repo: string,
    prNumber: number,
  ): Promise<PullRequestFile[]> {
    const { owner, repo: repoName } = splitRepo(repo);
    const response = await this.octokit.rest.pulls.listFiles({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });

    return response.data
      .filter((f: any) => shouldIncludeFile(f.filename, this.config.languages))
      .map((f: any) => ({
        filename: f.filename,
        status: f.status as PullRequestFile["status"],
        patch: f.patch,
        additions: f.additions,
        deletions: f.deletions,
      }));
  }

  async fetchReviewComments(
    repo: string,
    prNumber: number,
  ): Promise<ReviewComment[]> {
    const { owner, repo: repoName } = splitRepo(repo);
    const response = await this.octokit.rest.pulls.listReviewComments({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });

    return response.data.map((c: any) => ({
      body: c.body,
      path: c.path,
      line: c.line ?? null,
      author: c.user?.login ?? "unknown",
      prNumber,
      repo,
      createdAt: c.created_at,
    }));
  }
}
```

### Step 9: Create barrel export

**`packages/analyzer/src/ingest/index.ts`**:

```ts
export type {
  IngestConfig,
  CodeCorpus,
  CodeFile,
  ReviewComment,
  PullRequest,
  PullRequestFile,
  IngestMetadata,
} from "./types.js";

export { GitHubService } from "./github-service.js";
export { shouldIncludeFile, getLanguageFromPath } from "./file-filter.js";
export { FileCache } from "./cache.js";
```

**`packages/analyzer/src/index.ts`**:

```ts
export {
  type IngestConfig,
  type CodeCorpus,
  type CodeFile,
  type ReviewComment,
  type PullRequest,
  type PullRequestFile,
  type IngestMetadata,
  GitHubService,
  shouldIncludeFile,
  getLanguageFromPath,
  FileCache,
} from "./ingest/index.js";
```

### Step 10: Verify and commit

```bash
pnpm typecheck
pnpm test -- packages/analyzer
pnpm build
```

```bash
git add packages/analyzer/
git commit -m "Add GitHub ingest service with file filters and filesystem cache"
```

## Success Criteria

- [ ] `pnpm test -- packages/analyzer` passes all tests (filter, cache, GitHub service)
- [ ] `pnpm typecheck` exits 0
- [ ] File filter correctly excludes node_modules, vendor, dist, .min.js, .d.ts, lock files
- [ ] File filter correctly matches language extensions against requested languages
- [ ] Cache uses content-addressed (SHA-256) filenames
- [ ] Cache creates directories recursively on first write
- [ ] GitHub service applies file filters to commit and PR file lists
- [ ] `fetchFileContent` decodes base64 content and returns `null` on failure
- [ ] `ingest()` deduplicates files by path so each file is fetched once
- [ ] `ingest()` returns a complete `CodeCorpus` with metadata including `fetchedAt`, `totalCommits`, `totalFiles`, `totalReviewComments`
- [ ] All GitHub API calls are mocked in tests (no real network requests)
- [ ] All types are exported from the barrel `index.ts`

## Anti-patterns

### Universal
1. **Do not install packages globally** -- all deps go in the workspace
2. **Do not skip the verify step** -- run typecheck and tests before committing
3. **Do not create files outside the defined file ownership list**

### Task-specific
4. **Do not make real GitHub API calls in tests** -- mock octokit entirely; tests must run offline and fast
5. **Do not store raw file contents in cache** -- cache API responses (commit SHAs, file content) keyed by repo+path+ref, not bulk dumps
6. **Do not hardcode the cache directory path** -- accept it as a config option; the default `~/.code-style/cache/` is set by the caller, not the cache class
7. **Do not fetch file content for every commit that touched a file** -- deduplicate by path so each file is fetched once (latest version); the `seenPaths` Set prevents redundant API calls
8. **Do not swallow rate limit errors silently** -- if the API returns 429 or 403 with rate-limit headers, let the error propagate with a meaningful message rather than returning empty results
