import { describe, expect, it } from "vitest";
import { renderHtmlReport } from "../../src/visualizer/render";
import { RunResult } from "../../src/types";

describe("renderHtmlReport", () => {
  it("renders summary, repository, and commit content into standalone html", () => {
    const report: RunResult = {
      metadata: {
        schemaVersion: "1.0.0",
        generatedAt: "2026-04-06T05:32:01.316Z",
        authenticatedUser: "thilina01",
        targetAuthor: "thilina01",
        since: "2026-03-01T00:00:00.000Z",
        until: "2026-04-02T00:00:00.000Z",
        scanMode: "default_and_feature_branches",
        featureBranchScanEnabled: true,
        detectWip: false,
        includeDiffStats: false,
        classifyMessages: false,
        dryRun: false,
        filterField: "authoredDateTime",
        wipDetectionIsHeuristic: true,
      },
      statistics: {
        summary: {
          repositoriesScanned: 4,
          repositoriesWithCommits: 2,
          totalCommitsCollected: 8,
          uniqueCommits: 6,
          failedRepositories: 1,
          skippedRepositories: 1,
          durationSeconds: 10.5,
        },
        discovery: {
          repositoriesDiscovered: 4,
          repositoriesIncluded: 4,
        },
        skippedRepositories: [
          {
            repository: "org/empty",
            reason: "empty_repository",
          },
        ],
        perRepository: [
          {
            repository: "org/app",
            defaultBranch: "main",
            featureBranchScanEnabled: true,
            commitCount: 5,
            firstCommitAt: "2026-03-02T10:00:00.000Z",
            lastCommitAt: "2026-03-20T10:00:00.000Z",
            wipCommitCount: 0,
            mergeCommitCount: 0,
            externalAuthorMergeCount: 0,
          },
        ],
        timeSeries: {
          byDay: [{ date: "2026-03-02", commitCount: 2 }],
          byWeek: [{ weekStart: "2026-03-02T00:00:00.000Z", commitCount: 4 }],
          byMonth: [{ month: "2026-03", commitCount: 6 }],
          mostActiveDay: { date: "2026-03-02", commitCount: 2 },
          mostActiveRepository: { repository: "org/app", commitCount: 5 },
        },
      },
      failures: [
        {
          repository: "org/secret",
          stage: "default_branch_scan",
          errorType: "permission_denied",
          statusCode: 403,
          message: "Forbidden",
          retryCount: 0,
        },
      ],
      data: [
        {
          repository: "org/app",
          branch: "main",
          scanBranch: "main",
          observedBranches: ["main"],
          sha: "abc123456",
          message: "feat: improve dashboard",
          authoredDateTime: "2026-03-20T10:00:00.000Z",
          committedDateTime: "2026-03-20T10:01:00.000Z",
          url: "https://github.com/org/app/commit/abc123456",
          sourceMode: "default_branch",
          authorLogin: "thilina01",
          authorEmail: "thilina@example.com",
          isWip: false,
          isMergeCommit: false,
          mergeIncludesExternalAuthor: false,
          mergeBranchAuthorLogin: null,
        },
      ],
    };

    const html = renderHtmlReport(report);

    expect(html).toContain("GitHub Work Log");
    expect(html).toContain("org/app");
    expect(html).toContain("feat: improve dashboard");
    expect(html).toContain("Repositories Scanned");
    expect(html).toContain("Failures And Skips");
    expect(html).toContain("DASHBOARD_DATA");
  });
});
