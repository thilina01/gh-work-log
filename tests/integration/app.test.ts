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
    emails: [],
    includeOrgs: [],
    excludeOrgs: [],
    includeRepos: [],
    excludeRepos: [],
    branchPatterns: [],
    ownedOnly: false,
    organizationReport: false,
    scanFeatureBranches: true,
    includeDiffStats: true,
    detectWip: true,
    classifyMessages: true,
    enrichPrs: false,
    ignoreLocalConfig: false,
    verbose: false,
    dryRun: false,
    profile: "operator",
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
      parentCount: number;
      mergeIncludesExternalAuthor: boolean;
      mergeBranchAuthorLogin: string | null;
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

  public async getAssociatedPullRequests(): Promise<
    Array<{ number: number; url: string; title: string; state: string }>
  > {
    return [
      {
        number: 42,
        url: "https://github.com/alice/project-a/pull/42",
        title: "Add report",
        state: "merged",
      },
    ];
  }
}

describe("runApp", () => {
  it("overlaps branch discovery with the default scan and globally limits client operations", async () => {
    const repository = makeRepository("org/first");
    const client = new FakeGitHubClient([repository], {
      "org/first": [
        { branch: "main", commits: [] },
        { branch: "feature/a", commits: [] },
        { branch: "feature/b", commits: [] },
      ],
    });
    const originalListBranchCommits = client.listBranchCommits.bind(client);
    const originalListBranches = client.listBranches.bind(client);
    let activeRequests = 0;
    let peakRequests = 0;
    let branchDiscoveryOverlappedDefaultScan = false;
    let defaultScanActive = false;
    let branchDiscoveryActive = false;
    const scannedBranches: string[] = [];

    client.listBranches = async (repository) => {
      activeRequests += 1;
      peakRequests = Math.max(peakRequests, activeRequests);
      branchDiscoveryActive = true;
      branchDiscoveryOverlappedDefaultScan ||= defaultScanActive;
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return await originalListBranches(repository);
      } finally {
        branchDiscoveryActive = false;
        activeRequests -= 1;
      }
    };
    client.listBranchCommits = async (params) => {
      activeRequests += 1;
      peakRequests = Math.max(peakRequests, activeRequests);
      if (params.branch === "main") {
        defaultScanActive = true;
        branchDiscoveryOverlappedDefaultScan ||= branchDiscoveryActive;
      }
      scannedBranches.push(`${params.repository.fullName}:${params.branch}`);
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return await originalListBranchCommits(params);
      } finally {
        if (params.branch === "main") {
          defaultScanActive = false;
        }
        activeRequests -= 1;
      }
    };

    await runApp(makeConfig({ concurrency: 2 }), {
      client,
      writeJson: async () => {},
    });

    expect(peakRequests).toBe(2);
    expect(branchDiscoveryOverlappedDefaultScan).toBe(true);
    expect(scannedBranches).toHaveLength(3);
  });

  it("overlaps diff-stat fallback and pull-request enrichment when stats are omitted", async () => {
    const repository = makeRepository("alice/project-a");
    const client = new FakeGitHubClient(
      [repository],
      {
        "alice/project-a": [
          {
            branch: "main",
            commits: [
              makeObservation(
                repository,
                "main",
                "abc",
                "feat: add report",
                "2026-03-02T10:00:00.000Z",
              ),
            ],
          },
        ],
      },
    );
    const getStats = client.getCommitDiffStats.bind(client);
    const getPulls = client.getAssociatedPullRequests.bind(client);
    let activeEnrichments = 0;
    let enrichmentsOverlapped = false;

    client.getCommitDiffStats = async (...args) => {
      activeEnrichments += 1;
      enrichmentsOverlapped ||= activeEnrichments > 1;
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return await getStats(...args);
      } finally {
        activeEnrichments -= 1;
      }
    };
    client.getAssociatedPullRequests = async (...args) => {
      activeEnrichments += 1;
      enrichmentsOverlapped ||= activeEnrichments > 1;
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return await getPulls(...args);
      } finally {
        activeEnrichments -= 1;
      }
    };

    const result = await runApp(
      makeConfig({
        concurrency: 2,
        scanFeatureBranches: false,
        enrichPrs: true,
      }),
      {
        client,
        writeJson: async () => {},
      },
    );

    expect(enrichmentsOverlapped).toBe(true);
    expect(result.data[0]).toMatchObject({
      additions: 7,
      deletions: 3,
      filesChanged: 2,
      associatedPullRequests: [{ number: 42, state: "merged" }],
    });
  });

  it("reports all observed contributors for explicitly included organizations", async () => {
    const first = makeRepository("org/first");
    const second = makeRepository("org/second");
    const excluded = makeRepository("outside/repo");
    const client = new FakeGitHubClient(
      [first, second, excluded],
      {
        "org/first": [
          {
            branch: "main",
            commits: [
              {
                ...makeObservation(
                  first,
                  "main",
                  "alice-commit",
                  "feat: alice work",
                  "2026-03-02T10:00:00.000Z",
                ),
                authorLogin: "alice",
                authorEmail: "alice-private@example.com",
              },
              {
                ...makeObservation(
                  first,
                  "main",
                  "unknown-commit",
                  "fix: unattributed",
                  "2026-03-03T10:00:00.000Z",
                ),
                authorLogin: null,
                authorEmail: "unknown-private@example.com",
              },
            ],
          },
        ],
        "org/second": [
          {
            branch: "main",
            commits: [
              {
                ...makeObservation(
                  second,
                  "main",
                  "bob-commit",
                  "docs: bob work",
                  "2026-03-04T10:00:00.000Z",
                ),
                authorLogin: "bob",
                authorEmail: "bob-private@example.com",
              },
            ],
          },
        ],
      },
    );

    const result = await runApp(
      makeConfig({
        organizationReport: true,
        includeOrgs: ["org"],
        scanFeatureBranches: false,
        includeDiffStats: false,
      }),
      { client, writeJson: async () => {} },
    );

    expect(result.metadata.reportMode).toBe("organization");
    expect(result.metadata.targetAuthor).toBe("All contributors");
    expect(result.statistics.summary.uniqueCommits).toBe(3);
    expect(result.statistics.contributors).toEqual([
      { login: "alice", commitCount: 1, repositoryCount: 1 },
      { login: "bob", commitCount: 1, repositoryCount: 1 },
      { login: null, commitCount: 1, repositoryCount: 1 },
    ]);
    expect(result.data.map((commit) => commit.repository)).not.toContain("outside/repo");
    expect(JSON.stringify(result)).not.toContain("@example.com");
  });

  it("uses diff stats returned with commit history without making enrichment requests", async () => {
    const repository = makeRepository("alice/project-a");
    const client = new FakeGitHubClient(
      [repository],
      {
        "alice/project-a": [
          {
            branch: "main",
            commits: [
              {
                ...makeObservation(
                  repository,
                  "main",
                  "abc",
                  "feat: add report",
                  "2026-03-02T10:00:00.000Z",
                ),
                additions: 7,
                deletions: 3,
                filesChanged: 2,
              },
            ],
          },
        ],
      },
    );
    let diffStatRequests = 0;
    client.getCommitDiffStats = async () => {
      diffStatRequests += 1;
      return { additions: 0, deletions: 0, filesChanged: 0 };
    };

    const result = await runApp(
      makeConfig({ scanFeatureBranches: false }),
      { client, writeJson: async () => {} },
    );

    expect(diffStatRequests).toBe(0);
    expect(result.data[0]).toMatchObject({
      additions: 7,
      deletions: 3,
      filesChanged: 2,
    });
  });

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
    expect(result.metadata.schemaVersion).toBe("1.4.0");
    expect(result.metadata.profile).toBe("operator");
    expect(result.metadata.tool.name).toBe("gh-work-log");
    expect(result.metadata.ignoreLocalConfig).toBe(false);
    expect(result.metadata.enrichPrs).toBe(false);
    expect(result.statistics.skippedRepositories).toContainEqual({
      repository: "org/disabled",
      reason: "disabled_repository",
      category: "operational",
    });
    expect(result.statistics.skippedByCategory).toEqual({
      filter: 0,
      operational: 1,
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
  parentCount = 1,
  mergeIncludesExternalAuthor = false,
  mergeBranchAuthorLogin: string | null = null,
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
    parentCount,
    mergeIncludesExternalAuthor,
    mergeBranchAuthorLogin,
  } as const;
}

function sequenceNow(firstIso: string, secondIso: string): () => number {
  const values = [Date.parse(firstIso), Date.parse(secondIso)];
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}
