import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { renderHtmlReport } from "../../src/visualizer/render";
import { RunResult } from "../../src/types";
import { parseReportJson } from "../../src/report-validation";

function makeReport(overrides: Partial<RunResult> = {}): RunResult {
  const base: RunResult = {
    metadata: {
      schemaVersion: "1.2.0",
      generatedAt: "2026-04-06T05:32:01.316Z",
      authenticatedUser: "thilina01",
      targetAuthor: "thilina01",
      since: "2026-03-01T00:00:00.000Z",
      until: "2026-04-02T00:00:00.000Z",
      scanMode: "default_and_feature_branches",
      featureBranchScanEnabled: true,
      detectWip: false,
      includeDiffStats: true,
      classifyMessages: true,
      enrichPrs: false,
      ignoreLocalConfig: false,
      dryRun: false,
      profile: "operator",
      filters: {
        includeOrgs: ["org"],
        excludeOrgs: [],
        includeRepos: [],
        excludeRepos: [],
        ownedOnly: false,
        branchPatterns: [],
      },
      filterField: "authoredDateTime",
      wipDetectionIsHeuristic: true,
      tool: {
        name: "gh-work-log",
        packageVersion: "1.0.0",
      },
    },
    statistics: {
      summary: {
        repositoriesScanned: 4,
        repositoriesWithCommits: 2,
        totalCommitsCollected: 8,
        uniqueCommits: 6,
        failedRepositories: 1,
        skippedRepositories: 2,
        durationSeconds: 10.5,
      },
      discovery: {
        repositoriesDiscovered: 4,
        repositoriesIncluded: 4,
      },
      skippedByCategory: {
        filter: 1,
        operational: 1,
      },
      skippedRepositories: [
        {
          repository: "org/empty",
          reason: "empty_repository",
          category: "operational",
        },
        {
          repository: "other/personal",
          reason: "not_in_included_orgs",
          category: "filter",
        },
      ],
      highlights: {
        topRepositories: [{ repository: "org/app", commitCount: 5 }],
        uniqueCommits: 6,
        repositoriesWithCommits: 2,
        wipShare: 0,
        failureCount: 1,
        operationalSkipCount: 1,
        filterSkipCount: 1,
        messageCategoryMix: {
          feat: 4,
          fix: 1,
          refactor: 0,
          docs: 1,
          test: 0,
          chore: 0,
          other: 0,
        },
        codeLevel: {
          totalAdditions: 100,
          totalDeletions: 20,
          totalFilesChanged: 12,
        },
      },
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
      codeLevel: {
        totalAdditions: 100,
        totalDeletions: 20,
        totalFilesChanged: 12,
      },
      messageCategories: {
        feat: 4,
        fix: 1,
        refactor: 0,
        docs: 1,
        test: 0,
        chore: 0,
        other: 0,
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
        messageCategory: "feat",
      },
    ],
  };

  return {
    ...base,
    ...overrides,
    metadata: {
      ...base.metadata,
      ...(overrides.metadata ?? {}),
    },
    statistics: {
      ...base.statistics,
      ...(overrides.statistics ?? {}),
    },
  };
}

describe("renderHtmlReport", () => {
  it("accepts a complete report and rejects malformed report data", () => {
    const report = makeReport();

    expect(parseReportJson(JSON.stringify(report))).toEqual(report);
    const agentReport = makeReport();
    agentReport.metadata.profile = "agent";
    agentReport.statistics.hints = {
      candidateGroups: [
        {
          kind: "hint",
          id: "group-1",
          reason: "Related commits",
          commits: [{ repository: "org/app", sha: "abc123456" }],
        },
      ],
    };
    expect(parseReportJson(JSON.stringify(agentReport))).toEqual(agentReport);
    expect(() => parseReportJson("{")).toThrow("Input is not valid JSON:");
    expect(() =>
      parseReportJson(JSON.stringify({ metadata: {}, data: [], failures: [] })),
    ).toThrow("Invalid report: expected statistics to be an object.");
    expect(() =>
      parseReportJson(
        JSON.stringify({
          ...report,
          data: [{ ...report.data[0], isWip: "false" }],
        }),
      ),
    ).toThrow("Invalid report: expected data[0].isWip to be a boolean.");
  });

  it("filters and sorts commits in the rendered dashboard", () => {
    const report = makeReport();
    const firstCommit = report.data[0]!;
    report.data.push({
      ...firstCommit,
      sha: "def123456",
      message: "fix: later dashboard update",
      authoredDateTime: "2026-03-21T10:00:00.000Z",
    });

    const dom = new JSDOM(renderHtmlReport(report), {
      runScripts: "dangerously",
      url: "https://report.example/",
    });
    const { document, Event, MouseEvent } = dom.window;
    const tableBody = document.getElementById("commit-table-body")!;
    const search = document.getElementById("commit-search") as HTMLInputElement;
    const repositoryFilter = document.getElementById("repo-filter") as HTMLSelectElement;

    expect(tableBody.querySelectorAll("tr.commit-row")).toHaveLength(2);
    repositoryFilter.value = "org/app";
    repositoryFilter.dispatchEvent(new Event("change"));
    expect(tableBody.querySelectorAll("tr.commit-row")).toHaveLength(2);

    search.value = "fix: later";
    search.dispatchEvent(new Event("input"));
    expect(tableBody.querySelectorAll("tr.commit-row")).toHaveLength(1);
    expect(tableBody.textContent).toContain("fix: later dashboard update");

    search.value = "";
    search.dispatchEvent(new Event("input"));
    document.querySelector<HTMLElement>('[data-sort-key="authoredDateTime"]')!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(tableBody.querySelector("tr.commit-row")?.textContent).toContain("abc12345");
    dom.window.close();
  });

  it("renders summary, repository, and commit content into standalone html", () => {
    const html = renderHtmlReport(makeReport());

    expect(html).toContain("GitHub Work Log");
    expect(html).toContain("org/app");
    expect(html).toContain("feat: improve dashboard");
    expect(html).toContain("Repositories Scanned");
    expect(html).toContain("Failures And Skips");
    expect(html).toContain("Operational skips");
    expect(html).toContain("Filter skips");
    expect(html).toContain("other/personal");
    expect(html).toContain("Highlights");
    expect(html).toContain("Message category");
    expect(html).toContain("DASHBOARD_DATA");
  });

  it("hides filter skip repo names for management profile", () => {
    const report = makeReport({
      metadata: {
        ...makeReport().metadata,
        profile: "management",
      },
      statistics: {
        ...makeReport().statistics,
        skippedRepositories: [
          {
            repository: "org/empty",
            reason: "empty_repository",
            category: "operational",
          },
        ],
      },
    });

    const html = renderHtmlReport(report);

    expect(html).toContain("Report Profile");
    expect(html).toContain("Management");
    expect(html).toContain("Operational skips");
    expect(html).toContain("org/empty");
    expect(html).not.toContain("other/personal");
    expect(html).toContain(
      "1 repositories were excluded by include/exclude filters and omitted from this management report.",
    );
  });
});
