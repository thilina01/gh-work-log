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
    verbose: false,
    dryRun: false,
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
      messageCategory: "feat",
      additions: 10,
    });
    expect(commits[1]).toMatchObject({
      branch: "feature/work",
      isWip: true,
      wipReason: "not_in_default_branch",
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
        },
      ],
      repositoryMap: new Map([[repository.fullName, repository]]),
      skippedRepositories: [{ repository: "org/skipped", reason: "excluded_repository" }],
      failures: [],
      startedAtMs: Date.parse("2026-04-05T10:00:00.000Z"),
      endedAtMs: Date.parse("2026-04-05T10:00:02.500Z"),
    });

    expect(result.statistics.summary).toMatchObject({
      repositoriesScanned: 1,
      repositoriesWithCommits: 1,
      totalCommitsCollected: 1,
      uniqueCommits: 1,
      skippedRepositories: 1,
      durationSeconds: 2.5,
    });
    expect(result.statistics.timeSeries.byWeek).toEqual([
      { weekStart: "2026-03-02T00:00:00.000Z", commitCount: 1 },
    ]);
    expect(result.statistics.messageCategories).toEqual({
      feat: 0,
      fix: 0,
      refactor: 0,
      docs: 1,
      test: 0,
      chore: 0,
      other: 0,
    });
  });
});
