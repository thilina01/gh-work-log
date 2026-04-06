import { describe, expect, it } from "vitest";
import { runApp, type GitHubClientLike } from "../../src/app";
import { NormalizedConfig, RepositoryRecord, RunResult, TargetIdentity } from "../../src/types";

function makeConfig(overrides: Partial<NormalizedConfig> = {}): NormalizedConfig {
  return {
    since: new Date("2026-03-01T00:00:00.000Z"),
    until: new Date("2026-04-01T00:00:00.000Z"),
    sinceIso: "2026-03-01T00:00:00.000Z",
    untilIso: "2026-04-01T00:00:00.000Z",
    outputPath: "/tmp/report.json",
    requestedAuthor: undefined,
    emails: [],
    includeOrgs: [],
    excludeOrgs: [],
    includeRepos: [],
    excludeRepos: [],
    branchPatterns: [],
    ownedOnly: false,
    scanFeatureBranches: true,
    includeDiffStats: true,
    detectWip: true,
    classifyMessages: true,
    verbose: false,
    dryRun: false,
    concurrency: 5,
    retryPolicy: { maxRetries: 3, backoffMs: [1000, 2000, 4000] },
    ...overrides,
  };
}

class FakeGitHubClient implements GitHubClientLike {
  public constructor(
    private readonly repositories: RepositoryRecord[],
    private readonly branchObservations: Record<string, Array<{ branch: string; commits: unknown[] }>>,
  ) {}

  public async validateGhInstallation(): Promise<void> {}

  public async validateAuthentication(): Promise<void> {}

  public async getAuthenticatedUser(): Promise<{ login: string; id: string }> {
    return { login: "alice", id: "U_1" };
  }

  public async resolveTargetIdentity(
    requestedAuthor: string | undefined,
    authenticatedUser: { login: string; id: string },
    emails: string[],
  ): Promise<TargetIdentity> {
    return {
      login: requestedAuthor ?? authenticatedUser.login,
      id: authenticatedUser.id,
      emails,
    };
  }

  public async listRepositories(): Promise<RepositoryRecord[]> {
    return this.repositories;
  }

  public async listBranches(repository: RepositoryRecord): Promise<string[]> {
    return (this.branchObservations[repository.fullName] ?? []).map((entry) => entry.branch);
  }

  public async listBranchCommits(params: {
    repository: RepositoryRecord;
    branch: string;
    target: TargetIdentity;
  }): Promise<{
    observations: Array<{
      repository: string;
      defaultBranch: string;
      scanBranch: string;
      sha: string;
      message: string;
      messageHeadline: string;
      authoredDateTime: string;
      committedDateTime: string | null;
      url: string;
      sourceMode: "default_branch" | "feature_branch";
      authorLogin: string | null;
      authorEmail: string | null;
    }>;
    missingRef: boolean;
  }> {
    if (params.repository.fullName === "org/failing") {
      throw new Error("403 forbidden");
    }

    const branch = (this.branchObservations[params.repository.fullName] ?? []).find(
      (entry) => entry.branch === params.branch,
    );

    if (!branch) {
      return { observations: [], missingRef: params.repository.fullName === "org/empty" };
    }

    return { observations: branch.commits as never[], missingRef: false };
  }

  public async getCommitDiffStats(): Promise<{
    additions: number;
    deletions: number;
    filesChanged: number;
  }> {
    return { additions: 7, deletions: 3, filesChanged: 2 };
  }
}

describe("runApp", () => {
  it("writes a dry-run result with discovery and skip details", async () => {
    const repositories = [
      makeRepository("alice/project-a"),
      makeRepository("org/disabled", { isDisabled: true }),
    ];
    const writes: RunResult[] = [];

    const result = await runApp(
      makeConfig({ dryRun: true, scanFeatureBranches: false, includeDiffStats: false, classifyMessages: false, detectWip: false }),
      {
        client: new FakeGitHubClient(repositories, {}),
        now: sequenceNow("2026-04-05T10:00:00.000Z", "2026-04-05T10:00:00.500Z"),
        writeJson: async (_path, output) => {
          writes.push(output);
        },
      },
    );

    expect(result.metadata.dryRun).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.statistics.discovery).toEqual({
      repositoriesDiscovered: 2,
      repositoriesIncluded: 2,
    });
    expect(result.statistics.skippedRepositories).toContainEqual({
      repository: "org/disabled",
      reason: "disabled_repository",
    });
    expect(writes).toHaveLength(1);
  });

  it("scans repositories, deduplicates commits, enriches stats, and records failures", async () => {
    const repository = makeRepository("alice/project-a");
    const failingRepository = makeRepository("org/failing");
    const writes: RunResult[] = [];

    const result = await runApp(makeConfig(), {
      client: new FakeGitHubClient(
        [repository, failingRepository],
        {
          "alice/project-a": [
            {
              branch: "main",
              commits: [
                makeObservation(repository, "main", "abc", "feat: add report", "2026-03-02T10:00:00.000Z"),
              ],
            },
            {
              branch: "feature/cleanup",
              commits: [
                makeObservation(repository, "feature/cleanup", "abc", "feat: add report", "2026-03-02T10:00:00.000Z"),
                makeObservation(repository, "feature/cleanup", "def", "fix flaky test", "2026-03-03T11:00:00.000Z"),
              ],
            },
          ],
        },
      ),
      now: sequenceNow("2026-04-05T10:00:00.000Z", "2026-04-05T10:00:05.000Z"),
      writeJson: async (_path, output) => {
        writes.push(output);
      },
    });

    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      repository: "alice/project-a",
      branch: "main",
      observedBranches: ["feature/cleanup", "main"],
      additions: 7,
      filesChanged: 2,
      messageCategory: "feat",
      isWip: false,
    });
    expect(result.data[1]).toMatchObject({
      branch: "feature/cleanup",
      isWip: true,
      wipReason: "not_in_default_branch",
      messageCategory: "fix",
    });
    expect(result.failures).toEqual([
      expect.objectContaining({
        repository: "org/failing",
        stage: "default_branch_scan",
      }),
    ]);
    expect(result.statistics.summary).toMatchObject({
      repositoriesScanned: 2,
      repositoriesWithCommits: 1,
      totalCommitsCollected: 3,
      uniqueCommits: 2,
      failedRepositories: 1,
    });
    expect(writes).toHaveLength(1);
  });
});

function makeRepository(
  fullName: string,
  overrides: Partial<RepositoryRecord> = {},
): RepositoryRecord {
  const [ownerLogin = "", name = ""] = fullName.split("/");
  return {
    fullName,
    ownerLogin,
    name,
    visibility: "private",
    defaultBranch: "main",
    isArchived: false,
    isFork: false,
    isDisabled: false,
    isPrivate: true,
    htmlUrl: `https://github.com/${fullName}`,
    ...overrides,
  };
}

function makeObservation(
  repository: RepositoryRecord,
  scanBranch: string,
  sha: string,
  message: string,
  authoredDateTime: string,
) {
  return {
    repository: repository.fullName,
    defaultBranch: repository.defaultBranch ?? "main",
    scanBranch,
    sha,
    message,
    messageHeadline: message,
    authoredDateTime,
    committedDateTime: authoredDateTime,
    url: `${repository.htmlUrl}/commit/${sha}`,
    sourceMode:
      scanBranch === repository.defaultBranch ? "default_branch" : "feature_branch",
    authorLogin: "alice",
    authorEmail: "alice@example.com",
  } as const;
}

function sequenceNow(firstIso: string, secondIso: string): () => number {
  const values = [Date.parse(firstIso), Date.parse(secondIso)];
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}
