import { describe, expect, it } from "vitest";
import { GitHubClient } from "../../src/github/client";
import { Logger } from "../../src/logger";
import { CommandRunner, NormalizedConfig } from "../../src/types";

function makeConfig(): NormalizedConfig {
  return {
    since: new Date("2026-10-01T00:00:00.000Z"),
    until: new Date("2026-11-01T00:00:00.000Z"),
    sinceIso: "2026-10-01T00:00:00.000Z",
    untilIso: "2026-11-01T00:00:00.000Z",
    outputPath: "/tmp/report.json",
    emails: [],
    includeOrgs: [],
    excludeOrgs: [],
    includeRepos: [],
    excludeRepos: [],
    branchPatterns: [],
    ownedOnly: false,
    organizationReport: false,
    scanFeatureBranches: false,
    includeDiffStats: false,
    detectWip: false,
    classifyMessages: false,
    enrichPrs: false,
    enrichTasks: true,
    taskDetail: "full",
    workTracking: null,
    ignoreLocalConfig: false,
    verbose: false,
    dryRun: false,
    profile: "operator",
    concurrency: 5,
    retryPolicy: { maxRetries: 0, backoffMs: [] },
  };
}

function recordingRunner(
  results: Array<{ stdout: string; exitCode?: number; stderr?: string }>,
): { runner: CommandRunner; inputs: string[] } {
  const inputs: string[] = [];
  let index = 0;
  return {
    inputs,
    runner: {
      async run(_command, _args, options) {
        inputs.push(options?.input ?? "");
        const result = results[index++];
        if (!result) {
          throw new Error("Unexpected command invocation.");
        }
        return { stdout: result.stdout, stderr: result.stderr ?? "", exitCode: result.exitCode ?? 0 };
      },
    },
  };
}

const ISSUE_NODE = {
  number: 125,
  title: "Web - Order history",
  url: "https://github.com/acme/tasks/issues/125",
  state: "CLOSED",
  stateReason: "COMPLETED",
  createdAt: "2026-10-08T03:28:40Z",
  closedAt: "2026-10-12T02:52:08Z",
  body: "**Description**\nText",
  repository: { nameWithOwner: "acme/tasks" },
  issueType: { name: "Task" },
  labels: { nodes: [{ name: "CR" }] },
  assignees: { nodes: [{ login: "carol" }, { login: "alice" }] },
  milestone: null,
  parent: null,
  issueFieldValues: { nodes: [{ __typename: "IssueFieldSingleSelectValue", value: "Urgent", field: { name: "Priority" } }] },
  closedByPullRequestsReferences: { nodes: [] },
};

const PULL_NODE = {
  number: 175,
  title: "Client",
  url: "https://github.com/acme/web/pull/175",
  state: "MERGED",
  isDraft: false,
  createdAt: "2026-10-08T11:18:07Z",
  mergedAt: "2026-10-08T11:42:01Z",
  closedAt: "2026-10-08T11:42:01Z",
  body: "Implementation-Issue: #173",
  repository: { nameWithOwner: "acme/web" },
  headRefName: "task/173-wm125-x",
  baseRefName: "main",
  author: { login: "alice" },
  mergedBy: { login: "bob" },
  mergeCommit: { oid: "7cfa235" },
  additions: 322,
  deletions: 59,
  changedFiles: 6,
  commits: { totalCount: 1 },
  labels: { nodes: [] },
  reviews: { nodes: [{ author: { login: "github-actions" }, state: "COMMENTED", submittedAt: "2026-10-08T11:19:52Z" }] },
  closingIssuesReferences: { nodes: [{ number: 173, repository: { nameWithOwner: "acme/web" } }] },
};

describe("work-tracking GitHub client", () => {
  it("pages through the project board and splits Status from other fields", async () => {
    const page = (hasNextPage: boolean, endCursor: string | null, number: number) =>
      JSON.stringify({
        data: {
          owner: {
            projectV2: {
              title: "Delivery",
              url: "https://github.com/orgs/acme/projects/5",
              items: {
                pageInfo: { hasNextPage, endCursor },
                nodes: [
                  {
                    fieldValues: {
                      nodes: [
                        { __typename: "ProjectV2ItemFieldTextValue", text: "Title", field: { name: "Title" } },
                        { __typename: "ProjectV2ItemFieldSingleSelectValue", name: "Done", field: { name: "Status" } },
                        { __typename: "ProjectV2ItemFieldSingleSelectValue", name: "Orders", field: { name: "Module" } },
                        { __typename: "ProjectV2ItemFieldUserValue" },
                      ],
                    },
                    content: { __typename: "Issue", ...ISSUE_NODE, number },
                  },
                  { fieldValues: { nodes: [] }, content: { __typename: "DraftIssue" } },
                ],
              },
            },
          },
        },
      });
    const { runner, inputs } = recordingRunner([
      { stdout: page(true, "CURSOR", 125) },
      { stdout: page(false, null, 126) },
    ]);
    const client = new GitHubClient(makeConfig(), new Logger(false), runner);
    const board = await client.getProjectBoard({ ownerType: "organization", owner: "acme", number: 5 });

    expect(board.items.map((item) => item.issue.key)).toEqual([
      "acme/tasks#125",
      "acme/tasks#126",
    ]);
    expect(board.items[0]).toMatchObject({
      status: "Done",
      fields: { Module: "Orders" },
      issue: { issueFields: { Priority: "Urgent" }, assignees: ["alice", "carol"], issueType: "Task" },
    });
    expect(JSON.parse(inputs[1] ?? "{}").variables).toEqual({ owner: "acme", number: 5, after: "CURSOR" });
    expect(JSON.parse(inputs[0] ?? "{}").query).toContain("owner: organization(login: $owner)");
  });

  it("explains a missing project", async () => {
    const { runner } = recordingRunner([{ stdout: JSON.stringify({ data: { owner: { projectV2: null } } }) }]);
    const client = new GitHubClient(makeConfig(), new Logger(false), runner);
    await expect(
      client.getProjectBoard({ ownerType: "user", owner: "alice", number: 1 }),
    ).rejects.toMatchObject({ errorType: "work_tracking_invalid_response" });
  });

  it("keeps partial data from batched lookups when one item does not exist", async () => {
    const { runner, inputs } = recordingRunner([
      {
        stdout: JSON.stringify({
          data: { i0: { issue: ISSUE_NODE }, i1: { issue: null } },
          errors: [{ type: "NOT_FOUND", message: "Could not resolve to an Issue with the number of 999." }],
        }),
        exitCode: 1,
        stderr: "gh: Could not resolve to an Issue with the number of 999.",
      },
    ]);
    const client = new GitHubClient(makeConfig(), new Logger(false), runner);
    const result = await client.getIssuesBatch(["acme/tasks#125", "acme/tasks#999"]);

    expect(result.get("acme/tasks#125")?.title).toBe("Web - Order history");
    expect(result.get("acme/tasks#999")).toBeNull();
    expect(JSON.parse(inputs[0] ?? "{}").query).toContain(
      'i1: repository(owner: "acme", name: "tasks") { issue(number: 999)',
    );
  });

  it("still fails a batch that returned no data at all", async () => {
    const { runner } = recordingRunner([
      { stdout: JSON.stringify({ errors: [{ message: "Bad credentials" }] }), exitCode: 1, stderr: "HTTP 401" },
    ]);
    const client = new GitHubClient(makeConfig(), new Logger(false), runner);
    await expect(client.getPullRequestsBatch(["acme/web#175"])).rejects.toMatchObject({
      errorType: "work_tracking_pull_request_failed",
      statusCode: 401,
    });
  });

  it("maps pull requests and commit associations", async () => {
    const { runner } = recordingRunner([
      { stdout: JSON.stringify({ data: { p0: { pullRequest: PULL_NODE } } }) },
      {
        stdout: JSON.stringify({
          data: {
            c0: { object: { associatedPullRequests: { nodes: [PULL_NODE] } } },
            c1: { object: { associatedPullRequests: { nodes: [] } } },
            c2: { object: null },
          },
        }),
      },
    ]);
    const client = new GitHubClient(makeConfig(), new Logger(false), runner);
    const pulls = await client.getPullRequestsBatch(["acme/web#175"]);
    expect(pulls.get("acme/web#175")).toMatchObject({
      author: "alice",
      mergedBy: "bob",
      mergeCommitSha: "7cfa235",
      commitCount: 1,
      closingIssues: ["acme/web#173"],
      reviews: [{ author: "github-actions", state: "COMMENTED", submittedAt: "2026-10-08T11:19:52Z" }],
    });

    const byCommit = await client.getCommitPullRequestsBatch([
      { repository: "acme/web", sha: "7cfa235" },
      { repository: "acme/web", sha: "nopr" },
      { repository: "acme/web", sha: "missing" },
    ]);
    expect(byCommit.get("acme/web:7cfa235")?.map((pull) => pull.key)).toEqual(["acme/web#175"]);
    expect(byCommit.get("acme/web:nopr")).toEqual([]);
    expect(byCommit.has("acme/web:missing")).toBe(false);
  });

  it("rejects malformed pull request payloads", async () => {
    const { runner } = recordingRunner([
      { stdout: JSON.stringify({ data: { p0: { pullRequest: { ...PULL_NODE, additions: "many" } } } }) },
    ]);
    const client = new GitHubClient(makeConfig(), new Logger(false), runner);
    await expect(client.getPullRequestsBatch(["acme/web#175"])).rejects.toMatchObject({
      errorType: "work_tracking_invalid_response",
    });
  });
});
