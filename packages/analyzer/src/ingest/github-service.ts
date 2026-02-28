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
      const commits = await this.fetchCommitShas(repoFullName);
      totalCommits += commits.length;

      const seenPaths = new Set<string>();
      for (const sha of commits) {
        const commitFiles = await this.fetchCommitFiles(repoFullName, sha);
        for (const file of commitFiles) {
          if (seenPaths.has(file.filename)) continue;
          seenPaths.add(file.filename);

          const content = await this.fetchFileContent(
            repoFullName,
            file.filename,
            sha,
          );
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
        const comments = await this.fetchReviewComments(
          repoFullName,
          pr.number,
        );
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

    const shas = response.data.map(
      (c: { sha: string }) => c.sha,
    );

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

    const data = response.data as { files?: Record<string, unknown>[] };
    const files = data.files ?? [];
    return files
      .filter((f: Record<string, unknown>) =>
        shouldIncludeFile(f.filename as string, this.config.languages),
      )
      .map((f: Record<string, unknown>) => ({
        filename: f.filename as string,
        status: f.status as PullRequestFile["status"],
        patch: f.patch as string | undefined,
        additions: f.additions as number,
        deletions: f.deletions as number,
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

      const responseData = response.data as {
        content: string;
        encoding: string;
      };
      const content = Buffer.from(responseData.content, "base64").toString(
        "utf-8",
      );

      if (this.cache) {
        await this.cache.set(cacheKey, content);
      }

      return content;
    } catch (error: unknown) {
      // 404 = file not found (deleted, binary, etc.) — expected, return null
      if (error instanceof Error && "status" in error && (error as { status: number }).status === 404) {
        return null;
      }
      throw error;
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

    return response.data.map(
      (pr: {
        number: number;
        title: string;
        user: { login: string } | null;
      }) => ({
        number: pr.number,
        title: pr.title,
        repo,
        author: pr.user?.login ?? "unknown",
        files: [],
        comments: [],
      }),
    );
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
      .filter((f: Record<string, unknown>) =>
        shouldIncludeFile(f.filename as string, this.config.languages),
      )
      .map((f: Record<string, unknown>) => ({
        filename: f.filename as string,
        status: f.status as PullRequestFile["status"],
        patch: f.patch as string | undefined,
        additions: f.additions as number,
        deletions: f.deletions as number,
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

    return response.data.map(
      (c: {
        body: string;
        path: string;
        line?: number;
        user?: { login: string };
        created_at: string;
      }) => ({
        body: c.body,
        path: c.path,
        line: c.line ?? null,
        author: c.user?.login ?? "unknown",
        prNumber,
        repo,
        createdAt: c.created_at,
      }),
    );
  }
}
