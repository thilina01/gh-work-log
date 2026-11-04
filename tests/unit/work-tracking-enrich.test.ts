import { describe, expect, it } from "vitest";
import { Logger } from "../../src/logger";
import { CommitRecord } from "../../src/types";
import { repositoryShaKey } from "../../src/utils/collections";
import { enrichWorkTracking } from "../../src/work-tracking/enrich";
import { GhPullRequest, TaskDetailLevel } from "../../src/work-tracking/types";
import {
  DOCS,
  FakeWorkTrackingClient,
  API,
  makeCommit,
  makePull,
  makeSettings,
  WEB,
  WM,
} from "../helpers/work-tracking";

function scenario(): { commits: CommitRecord[]; client: FakeWorkTrackingClient } {
  const commitPulls = new Map<string, GhPullRequest[]>([
    [repositoryShaKey(WEB, "shaA"), [makePull(WEB, 210, { body: "Parent-Task: acme/tasks#200" })]],
    [repositoryShaKey(WEB, "shaB"), [makePull(WEB, 220, { closingIssues: [`${WEB}#173`] })]],
    [repositoryShaKey(WEB, "shaC"), [makePull(WEB, 230, { headRefName: "task/5-wm200-tickets" })]],
    [repositoryShaKey(WEB, "shaF"), [makePull(WEB, 240)]],
    [repositoryShaKey(WEB, "shaI"), [makePull(WEB, 250, { body: "Parent-Task: #404" })]],
  ]);
  const client = new FakeWorkTrackingClient(undefined, undefined, undefined, commitPulls);
  const commits = [
    makeCommit(WEB, "sha175", { additions: 300, deletions: 50 }),
    makeCommit(API, "sha62", { authorLogin: "bob", additions: 20, deletions: 5 }),
    makeCommit(WEB, "shaA"),
    makeCommit(WEB, "shaB"),
    makeCommit(WEB, "shaC"),
    makeCommit(WEB, "shaD", {
      branch: "task/9-wm125-wip",
      scanBranch: "task/9-wm125-wip",
      sourceMode: "feature_branch",
    }),
    makeCommit(WEB, "shaE"),
    makeCommit(WEB, "shaF"),
    makeCommit(DOCS, "shaG"),
    makeCommit("bob/personal", "shaH"),
    makeCommit(WEB, "sha301"),
    makeCommit(WEB, "shaI"),
  ];
  return { commits, client };
}

async function run(
  commits: CommitRecord[],
  client: FakeWorkTrackingClient,
  taskDetail: TaskDetailLevel = "full",
) {
  return enrichWorkTracking({
    commits,
    board: client.board,
    settings: makeSettings(),
    taskDetail,
    includeDiffStats: true,
    client,
    concurrency: 2,
    snapshotAt: "2026-11-04T00:00:00.000Z",
    logger: new Logger(false),
  });
}

function linkOf(commits: CommitRecord[], sha: string) {
  return commits.find((commit) => commit.sha === sha)?.workLink;
}

describe("work-tracking enrichment", () => {
  it("links commits by merge commit, pull request, and branch, and records why others are unlinked", async () => {
    const { commits, client } = scenario();
    const { report, failures } = await run(commits, client);

    expect(failures).toEqual([]);
    expect(linkOf(commits, "sha175")).toEqual({
      status: "linked",
      task: `${WM}#125`,
      subIssue: `${WEB}#173`,
      pullRequest: `${WEB}#175`,
      linkSource: "merge_sha",
      confidence: "high",
      unlinkedReason: null,
    });
    expect(linkOf(commits, "sha62")).toMatchObject({ task: `${WM}#125`, subIssue: `${API}#60`, linkSource: "merge_sha" });
    expect(linkOf(commits, "shaA")).toMatchObject({ task: `${WM}#200`, subIssue: null, linkSource: "pr_trailer", confidence: "high" });
    expect(linkOf(commits, "shaB")).toMatchObject({ task: `${WM}#125`, subIssue: `${WEB}#173`, linkSource: "pr_closing_ref" });
    expect(linkOf(commits, "shaC")).toMatchObject({ task: `${WM}#200`, linkSource: "pr_branch", confidence: "medium" });
    expect(linkOf(commits, "shaD")).toMatchObject({ task: `${WM}#125`, pullRequest: null, linkSource: "branch_name" });
    expect(linkOf(commits, "shaE")).toMatchObject({ status: "unlinked", unlinkedReason: "no_pull_request" });
    expect(linkOf(commits, "shaF")).toMatchObject({
      status: "unlinked",
      pullRequest: `${WEB}#240`,
      unlinkedReason: "pull_request_without_task",
    });
    expect(linkOf(commits, "shaG")).toMatchObject({ unlinkedReason: "exempt_repository" });
    expect(linkOf(commits, "shaH")).toMatchObject({ unlinkedReason: "out_of_scope_repository" });
    // The parent task of a board sub-issue is fetched; off-board tasks lower confidence.
    expect(linkOf(commits, "sha301")).toMatchObject({
      task: `${WM}#999`,
      subIssue: `${WEB}#300`,
      linkSource: "merge_sha",
      confidence: "medium",
    });
    // A trailer naming an issue that does not exist leaves the commit unlinked.
    expect(linkOf(commits, "shaI")).toMatchObject({ unlinkedReason: "pull_request_without_task" });

    expect(report.coverage).toEqual({
      commits: 12,
      linked: 7,
      unlinked: 5,
      linkedBySource: { merge_sha: 3, pr_closing_ref: 1, pr_trailer: 1, pr_branch: 1, branch_name: 1 },
      unlinkedByReason: {
        out_of_scope_repository: 1,
        exempt_repository: 1,
        no_pull_request: 1,
        pull_request_without_task: 2,
        lookup_failed: 0,
      },
    });

    // Only commits without a merge-commit match and in scope are looked up.
    expect(client.calls.commitPulls.flat().map((commit) => commit.sha).sort()).toEqual(
      ["shaA", "shaB", "shaC", "shaD", "shaE", "shaF", "shaI"],
    );
    // A bare `#404` in the task trailer names a task in the task repository.
    expect(client.calls.issues.flat().sort()).toEqual([`${WM}#404`, `${WM}#999`]);
    expect(client.calls.pulls.flat().sort()).toEqual([`${API}#62`, `${WEB}#175`, `${WEB}#301`]);
  });

  it("builds task, sub-issue, and pull request records with full detail", async () => {
    const { commits, client } = scenario();
    const { report } = await run(commits, client);

    expect(Object.keys(report.tasks)).toEqual([`${WM}#125`, `${WM}#200`, `${WM}#999`]);
    const task = report.tasks[`${WM}#125`]!;
    expect(task).toMatchObject({
      title: "Web - Order history",
      labels: ["CR"],
      status: "Done",
      onBoard: true,
      boardFields: { Module: "Orders", System: "Web" },
      issueFields: { Priority: "Urgent" },
      fields: { "Requested by": "Sales", "BA task": "#77" },
      subIssues: [`${API}#60`, `${WEB}#173`],
      pullRequests: [`${API}#62`, `${WEB}#175`, `${WEB}#220`],
      completeness: [],
    });
    expect(task.sections?.Description).toBe("Show order history date by date.");
    expect(task.activity).toEqual({
      commitCount: 4,
      repositories: [API, WEB],
      firstCommitAt: "2026-10-08T11:42:01.000Z",
      lastCommitAt: "2026-10-08T11:42:01.000Z",
      additions: 320,
      deletions: 55,
      authors: [
        { login: "alice", commitCount: 3 },
        { login: "bob", commitCount: 1 },
      ],
    });
    expect(report.tasks[`${WM}#999`]).toMatchObject({
      onBoard: false,
      status: null,
      completeness: ["not_on_board", "body_empty"],
    });
    expect(report.tasks[`${WM}#200`]?.fields).toEqual({ "Requested by": "Finance Department" });

    expect(report.subIssues[`${WEB}#173`]).toMatchObject({
      task: `${WM}#125`,
      parent: `${WM}#125`,
      closingPullRequests: [`${WEB}#175`],
      body: "See the task.",
    });

    const pull = report.pullRequests[`${WEB}#175`]!;
    expect(pull).toMatchObject({ task: `${WM}#125`, subIssue: `${WEB}#173`, mergeCommitSha: "sha175" });
    expect(pull.trailers).toEqual({
      "Parent-Task": "acme/tasks#125",
      "Implementation-Issue": "#173",
    });
    expect(pull.sections?.["Dev verification"]).not.toContain("Parent-Task");
    expect(report.pullRequests[`${WEB}#240`]).toMatchObject({ task: null, subIssue: null });
    expect(report.board).toMatchObject({ owner: "acme", number: 5, itemCount: 5 });
  });

  it("limits text by detail level", async () => {
    const summary = scenario();
    const summaryReport = (await run(summary.commits, summary.client, "summary")).report;
    const summaryTask = summaryReport.tasks[`${WM}#125`]!;
    expect(summaryTask.fields).toEqual({ "Requested by": "Sales", "BA task": "#77" });
    expect(summaryTask.sections).toBeUndefined();
    expect(summaryReport.pullRequests[`${WEB}#175`]?.sections).toBeUndefined();
    expect(summaryReport.subIssues[`${WEB}#173`]?.body).toBeUndefined();

    const none = scenario();
    const noneReport = (await run(none.commits, none.client, "none")).report;
    expect(noneReport.tasks[`${WM}#125`]?.fields).toBeUndefined();
    expect(noneReport.pullRequests[`${WEB}#175`]?.trailers).toEqual({
      "Parent-Task": "acme/tasks#125",
      "Implementation-Issue": "#173",
    });
  });

  it("records lookup failures and still links by branch name", async () => {
    const { commits, client } = scenario();
    client.failCommitPullsFor.add(WEB);
    const { report, failures } = await run(commits, client);

    expect(failures).toEqual([
      expect.objectContaining({ repository: WEB, stage: "work_tracking", message: "502 bad gateway" }),
    ]);
    expect(linkOf(commits, "shaD")).toMatchObject({ linkSource: "branch_name" });
    expect(linkOf(commits, "shaE")).toMatchObject({ unlinkedReason: "lookup_failed" });
    expect(linkOf(commits, "sha175")).toMatchObject({ linkSource: "merge_sha" });
    // Every in-scope acme/web commit without a merge-commit match or a task branch.
    expect(report.coverage.unlinkedByReason.lookup_failed).toBe(6);
  });

  it("produces identical output across runs", async () => {
    const first = scenario();
    const second = scenario();
    const a = await run(first.commits, first.client);
    const b = await run(second.commits, second.client);
    expect(JSON.stringify(a.report)).toBe(JSON.stringify(b.report));
    expect(JSON.stringify(first.commits)).toBe(JSON.stringify(second.commits));
  });
});
