import { describe, expect, it } from "vitest";
import { buildCommitRecords, buildRunResult } from "../../src/aggregation";
import { NormalizedConfig, RepositoryRecord } from "../../src/types";

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

describe("aggregation", () => {
  it("deduplicates commits and prefers the default branch as canonical", () => {
    const repository: RepositoryRecord = {
      fullName: "org/service",
      ownerLogin: "org",
      name: "service",
      visibility: "private",
      defaultBranch: "main",
      isArchived: false,
      isFork: false,
      isDisabled: false,
      isPrivate: true,
      htmlUrl: "https://github.com/org/service",
    };

    const commits = buildCommitRecords(
      [
        {
          repository: repository.fullName,
          defaultBranch: "main",
          scanBranch: "main",
          sha: "abc",
          message: "feat: add endpoint",
          messageHeadline: "feat: add endpoint",
          authoredDateTime: "2026-03-02T10:00:00.000Z",
          committedDateTime: "2026-03-02T10:01:00.000Z",
          url: "https://github.com/org/service/commit/abc",
          sourceMode: "default_branch",
          authorLogin: "alice",
          authorEmail: "alice@example.com",
          parentCount: 1,
          mergeIncludesExternalAuthor: false,
          mergeBranchAuthorLogin: null,
          additions: 10,
          deletions: 2,
          filesChanged: 1,
        },
        {
          repository: repository.fullName,
          defaultBranch: "main",
          scanBranch: "feature/work",
          sha: "abc",
          message: "feat: add endpoint",
          messageHeadline: "feat: add endpoint",
          authoredDateTime: "2026-03-02T10:00:00.000Z",
          committedDateTime: "2026-03-02T10:01:00.000Z",
          url: "https://github.com/org/service/commit/abc",
          sourceMode: "feature_branch",
          authorLogin: "alice",
          authorEmail: "alice@example.com",
          parentCount: 1,
          mergeIncludesExternalAuthor: false,
          mergeBranchAuthorLogin: null,
        },
        {
          repository: repository.fullName,
          defaultBranch: "main",
          scanBranch: "feature/work",
          sha: "def",
          message: "fix flaky test",
          messageHeadline: "fix flaky test",
          authoredDateTime: "2026-03-03T09:00:00.000Z",
          committedDateTime: "2026-03-03T09:01:00.000Z",
          url: "https://github.com/org/service/commit/def",
          sourceMode: "feature_branch",
          authorLogin: "alice",
          authorEmail: "alice@example.com",
          parentCount: 2,
          mergeIncludesExternalAuthor: true,
          mergeBranchAuthorLogin: "bob",
          additions: 1,
          deletions: 3,
          filesChanged: 2,
        },
      ],
      new Map([[repository.fullName, repository]]),
      makeConfig(),
    );

    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      branch: "main",
      observedBranches: ["feature/work", "main"],
      isWip: false,
      isMergeCommit: false,
      messageCategory: "feat",
      additions: 10,
    });
    expect(commits[1]).toMatchObject({
      branch: "feature/work",
      isWip: true,
      wipReason: "not_in_default_branch",
      isMergeCommit: true,
      mergeIncludesExternalAuthor: true,
      mergeBranchAuthorLogin: "bob",
      messageCategory: "fix",
    });
  });

  it("builds deterministic statistics", () => {
    const repository: RepositoryRecord = {
      fullName: "org/service",
      ownerLogin: "org",
      name: "service",
      visibility: "private",
      defaultBranch: "main",
      isArchived: false,
      isFork: false,
      isDisabled: false,
      isPrivate: true,
      htmlUrl: "https://github.com/org/service",
    };

    const result = buildRunResult({
      config: makeConfig(),
      authenticatedUser: "alice",
      targetAuthor: "alice",
      repositoriesDiscovered: 3,
      repositoriesIncluded: 2,
      scannedRepositoryCount: 1,
      observations: [
        {
          repository: repository.fullName,
          defaultBranch: "main",
          scanBranch: "main",
          sha: "abc",
          message: "docs: update",
          messageHeadline: "docs: update",
          authoredDateTime: "2026-03-02T10:00:00.000Z",
          committedDateTime: "2026-03-02T10:01:00.000Z",
          url: "https://github.com/org/service/commit/abc",
          sourceMode: "default_branch",
          authorLogin: "alice",
          authorEmail: "alice@example.com",
          parentCount: 1,
          mergeIncludesExternalAuthor: false,
          mergeBranchAuthorLogin: null,
        },
        {
          repository: repository.fullName,
          defaultBranch: "main",
          scanBranch: "main",
          sha: "merge1",
          message: "Merge pull request #4 from org/service-branch",
          messageHeadline: "Merge pull request #4 from org/service-branch",
          authoredDateTime: "2026-03-02T11:00:00.000Z",
          committedDateTime: "2026-03-02T11:00:00.000Z",
          url: "https://github.com/org/service/commit/merge1",
          sourceMode: "default_branch",
          authorLogin: "alice",
          authorEmail: "alice@example.com",
          parentCount: 2,
          mergeIncludesExternalAuthor: true,
          mergeBranchAuthorLogin: "bob",
        },
      ],
      repositoryMap: new Map([[repository.fullName, repository]]),
      skippedRepositories: [{ repository: "org/skipped", reason: "excluded_repository" }],
      failures: [],
      startedAtMs: Date.parse("2026-04-05T10:00:00.000Z"),
      endedAtMs: Date.parse("2026-04-05T10:00:02.500Z"),
    });

    expect(result.metadata.schemaVersion).toBe("1.2.0");
    expect(result.metadata.profile).toBe("operator");
    expect(result.metadata.enrichPrs).toBe(false);
    expect(result.metadata.ignoreLocalConfig).toBe(false);
    expect(result.metadata.tool.name).toBe("gh-work-log");
    expect(result.metadata.tool.packageVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(result.statistics.hints).toBeUndefined();
    expect(result.metadata.filters).toEqual({
      includeOrgs: [],
      excludeOrgs: [],
      includeRepos: [],
      excludeRepos: [],
      ownedOnly: false,
      branchPatterns: [],
    });
    expect(result.statistics.summary).toMatchObject({
      repositoriesScanned: 1,
      repositoriesWithCommits: 1,
      totalCommitsCollected: 2,
      uniqueCommits: 2,
      skippedRepositories: 1,
      durationSeconds: 2.5,
    });
    expect(result.statistics.skippedByCategory).toEqual({
      filter: 1,
      operational: 0,
    });
    expect(result.statistics.skippedRepositories).toEqual([
      {
        repository: "org/skipped",
        reason: "excluded_repository",
        category: "filter",
      },
    ]);
    expect(result.statistics.highlights).toMatchObject({
      uniqueCommits: 2,
      repositoriesWithCommits: 1,
      wipShare: 0,
      failureCount: 0,
      filterSkipCount: 1,
      operationalSkipCount: 0,
      topRepositories: [{ repository: "org/service", commitCount: 2 }],
    });
    expect(result.statistics.perRepository).toEqual([
      expect.objectContaining({
        repository: "org/service",
        commitCount: 2,
        wipCommitCount: 0,
        mergeCommitCount: 1,
        externalAuthorMergeCount: 1,
      }),
    ]);
    expect(result.statistics.timeSeries.byWeek).toEqual([
      { weekStart: "2026-03-02T00:00:00.000Z", commitCount: 2 },
    ]);
    expect(result.statistics.messageCategories).toEqual({
      feat: 0,
      fix: 0,
      refactor: 0,
      docs: 1,
      test: 0,
      chore: 0,
      other: 1,
    });
  });

  it("collapses filter skips for management and agent profiles", () => {
    const repository: RepositoryRecord = {
      fullName: "org/service",
      ownerLogin: "org",
      name: "service",
      visibility: "private",
      defaultBranch: "main",
      isArchived: false,
      isFork: false,
      isDisabled: false,
      isPrivate: true,
      htmlUrl: "https://github.com/org/service",
    };

    const result = buildRunResult({
      config: makeConfig({
        profile: "management",
        includeOrgs: ["org"],
        classifyMessages: false,
        includeDiffStats: false,
      }),
      authenticatedUser: "alice",
      targetAuthor: "alice",
      repositoriesDiscovered: 3,
      repositoriesIncluded: 1,
      scannedRepositoryCount: 1,
      observations: [
        {
          repository: repository.fullName,
          defaultBranch: "main",
          scanBranch: "main",
          sha: "abc",
          message: "docs: update",
          messageHeadline: "docs: update",
          authoredDateTime: "2026-03-02T10:00:00.000Z",
          committedDateTime: "2026-03-02T10:01:00.000Z",
          url: "https://github.com/org/service/commit/abc",
          sourceMode: "default_branch",
          authorLogin: "alice",
          authorEmail: "alice@example.com",
          parentCount: 1,
          mergeIncludesExternalAuthor: false,
          mergeBranchAuthorLogin: null,
        },
      ],
      repositoryMap: new Map([[repository.fullName, repository]]),
      skippedRepositories: [
        { repository: "other/personal", reason: "not_in_included_orgs" },
        { repository: "org/empty", reason: "empty_repository" },
      ],
      failures: [],
      startedAtMs: Date.parse("2026-04-05T10:00:00.000Z"),
      endedAtMs: Date.parse("2026-04-05T10:00:01.000Z"),
    });

    expect(result.metadata.profile).toBe("management");
    expect(result.metadata.filters.includeOrgs).toEqual(["org"]);
    expect(result.statistics.skippedByCategory).toEqual({
      filter: 1,
      operational: 1,
    });
    expect(result.statistics.summary.skippedRepositories).toBe(2);
    expect(result.statistics.skippedRepositories).toEqual([
      {
        repository: "org/empty",
        reason: "empty_repository",
        category: "operational",
      },
    ]);
    expect(result.statistics.highlights.filterSkipCount).toBe(1);
    expect(result.statistics.highlights.operationalSkipCount).toBe(1);
  });

  it("emits candidate group hints only for the agent profile", () => {
    const api: RepositoryRecord = {
      fullName: "org/foo-api",
      ownerLogin: "org",
      name: "foo-api",
      visibility: "private",
      defaultBranch: "main",
      isArchived: false,
      isFork: false,
      isDisabled: false,
      isPrivate: true,
      htmlUrl: "https://github.com/org/foo-api",
    };
    const client: RepositoryRecord = {
      ...api,
      fullName: "org/foo-client",
      name: "foo-client",
      htmlUrl: "https://github.com/org/foo-client",
    };

    const observations = [
      {
        repository: api.fullName,
        defaultBranch: "main",
        scanBranch: "main",
        sha: "aaa",
        message: "feat: handle #42",
        messageHeadline: "feat: handle #42",
        authoredDateTime: "2026-03-02T10:00:00.000Z",
        committedDateTime: "2026-03-02T10:01:00.000Z",
        url: "https://github.com/org/foo-api/commit/aaa",
        sourceMode: "default_branch" as const,
        authorLogin: "alice",
        authorEmail: "alice@example.com",
        parentCount: 1,
        mergeIncludesExternalAuthor: false,
        mergeBranchAuthorLogin: null,
      },
      {
        repository: client.fullName,
        defaultBranch: "main",
        scanBranch: "main",
        sha: "bbb",
        message: "feat: show #42",
        messageHeadline: "feat: show #42",
        authoredDateTime: "2026-03-02T11:00:00.000Z",
        committedDateTime: "2026-03-02T11:01:00.000Z",
        url: "https://github.com/org/foo-client/commit/bbb",
        sourceMode: "default_branch" as const,
        authorLogin: "alice",
        authorEmail: "alice@example.com",
        parentCount: 1,
        mergeIncludesExternalAuthor: false,
        mergeBranchAuthorLogin: null,
      },
    ];

    const agent = buildRunResult({
      config: makeConfig({ profile: "agent", includeDiffStats: false }),
      authenticatedUser: "alice",
      targetAuthor: "alice",
      repositoriesDiscovered: 2,
      repositoriesIncluded: 2,
      scannedRepositoryCount: 2,
      observations,
      repositoryMap: new Map([
        [api.fullName, api],
        [client.fullName, client],
      ]),
      skippedRepositories: [],
      failures: [],
      startedAtMs: Date.parse("2026-04-05T10:00:00.000Z"),
      endedAtMs: Date.parse("2026-04-05T10:00:01.000Z"),
    });

    const operator = buildRunResult({
      config: makeConfig({ profile: "operator", includeDiffStats: false }),
      authenticatedUser: "alice",
      targetAuthor: "alice",
      repositoriesDiscovered: 2,
      repositoriesIncluded: 2,
      scannedRepositoryCount: 2,
      observations,
      repositoryMap: new Map([
        [api.fullName, api],
        [client.fullName, client],
      ]),
      skippedRepositories: [],
      failures: [],
      startedAtMs: Date.parse("2026-04-05T10:00:00.000Z"),
      endedAtMs: Date.parse("2026-04-05T10:00:01.000Z"),
    });

    expect(operator.statistics.hints).toBeUndefined();
    expect(agent.statistics.hints?.candidateGroups.length).toBeGreaterThan(0);
    expect(agent.data.map((commit) => commit.sha).sort()).toEqual(
      operator.data.map((commit) => commit.sha).sort(),
    );
    for (const group of agent.statistics.hints?.candidateGroups ?? []) {
      expect(group.kind).toBe("hint");
      for (const member of group.commits) {
        expect(
          agent.data.some(
            (commit) =>
              commit.repository === member.repository && commit.sha === member.sha,
          ),
        ).toBe(true);
      }
    }
  });
});
