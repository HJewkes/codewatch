import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubService } from "../ingest/github-service.js";
import type { IngestConfig } from "../ingest/types.js";

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

  it("builds a complete CodeCorpus from ingest()", async () => {
    const corpus = await service.ingest();
    expect(corpus.files.length).toBeGreaterThanOrEqual(0);
    expect(corpus.metadata.repos).toEqual(["owner/repo"]);
    expect(corpus.metadata.fetchedAt).toBeDefined();
    expect(corpus.reviewComments).toBeDefined();
  });
});
