import { CommitRecord } from "../../src/types";
import { repositoryShaKey } from "../../src/utils/collections";
import {
  CommitRef,
  GhBoard,
  GhIssue,
  GhPullRequest,
  WorkTrackingClient,
  WorkTrackingSettings,
} from "../../src/work-tracking/types";

export const WM = "acme/tasks";
export const WEB = "acme/web";
export const API = "acme/api";
export const DOCS = "acme/docs";

export function makeSettings(overrides: Partial<WorkTrackingSettings> = {}): WorkTrackingSettings {
  return {
    project: { ownerType: "organization", owner: "acme", number: 5 },
    taskRepository: WM,
    repositoryOwners: ["acme"],
    exemptRepositories: [DOCS],
    branchTaskPattern: "-wm(\\d+)-",
    taskTrailer: "Parent-Task",
    subIssueTrailer: "Implementation-Issue",
    taskSections: ["Description", "Requirements", "Acceptance Criteria"],
    taskFields: ["Requested by", "BA task"],
    pullRequestSections: ["Summary", "Test plan", "Dev verification", "What to Review"],
    ...overrides,
  };
}

export function makeIssue(repository: string, number: number, overrides: Partial<GhIssue> = {}): GhIssue {
  return {
    key: `${repository}#${number}`,
    repository,
    number,
    title: `Issue ${number}`,
    url: `https://github.com/${repository}/issues/${number}`,
    state: "CLOSED",
    stateReason: "COMPLETED",
    createdAt: "2026-10-01T00:00:00Z",
    closedAt: "2026-10-12T00:00:00Z",
    body: "",
    issueType: "Task",
    labels: [],
    assignees: ["alice"],
    milestone: null,
    parentKey: null,
    issueFields: {},
    closingPullRequests: [],
    ...overrides,
  };
}

export function makePull(repository: string, number: number, overrides: Partial<GhPullRequest> = {}): GhPullRequest {
  return {
    key: `${repository}#${number}`,
    repository,
    number,
    title: `PR ${number}`,
    url: `https://github.com/${repository}/pull/${number}`,
    state: "MERGED",
    isDraft: false,
    createdAt: "2026-10-08T11:18:07Z",
    mergedAt: "2026-10-08T11:42:01Z",
    closedAt: "2026-10-08T11:42:01Z",
    body: "",
    author: "alice",
    mergedBy: "bob",
    headRefName: "feature/x",
    baseRefName: "main",
    mergeCommitSha: null,
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    commitCount: 1,
    labels: [],
    reviews: [],
    closingIssues: [],
    ...overrides,
  };
}

export function makeCommit(repository: string, sha: string, overrides: Partial<CommitRecord> = {}): CommitRecord {
  return {
    repository,
    branch: "main",
    scanBranch: "main",
    sha,
    message: `commit ${sha}`,
    authoredDateTime: "2026-10-08T11:42:01.000Z",
    committedDateTime: "2026-10-08T11:42:01.000Z",
    url: `https://github.com/${repository}/commit/${sha}`,
    sourceMode: "default_branch",
    authorLogin: "alice",
    authorEmail: null,
    isWip: false,
    isMergeCommit: false,
    mergeIncludesExternalAuthor: false,
    mergeBranchAuthorLogin: null,
    ...overrides,
  };
}

/** Hand-written task body (bold headings and footer lines), as filed before the issue forms. */
export const HAND_WRITTEN_TASK_BODY = [
  "**Description**",
  "Show order history date by date.",
  "",
  "**Requirements**",
  "- Use the selected store and date range.",
  "",
  "**Acceptance Criteria**",
  "- Each date is shown separately.\\",
  "",
  '<img width="10" alt="Image" src="https://example.com/a.png" />',
  "",
  "> Requested by : Sales",
  "> BA task : #77",
].join("\n");

/** Issue-form task body (`###` headings), with an extra heading inside Requirements. */
export const FORM_TASK_BODY = [
  "### Description",
  "",
  "Add printable invoices.",
  "",
  "### Requirements",
  "",
  "- Add the module.",
  "",
  "### Invoice Header",
  "",
  "- Invoice Number",
  "",
  "### Acceptance Criteria",
  "",
  "- Invoices can be printed.",
  "",
  "### Requested by",
  "",
  "Finance Department",
  "",
  "### BA task",
  "",
  "_No response_",
  "",
  "### Screenshots",
  "",
  "![shot](https://example.com/b.png)",
].join("\n");

/** Pull request body with CRLF line endings and trailers inside a section. */
export const PR_BODY = [
  "## Summary",
  "Date filter added.",
  "",
  "## Dev verification",
  "Verified on `dev` with feature image `wm-125-sub-173-abc12345-1-a1`.",
  "",
  "Closes #173",
  "",
  "Implementation-Issue: #173",
  "Parent-Task: acme/tasks#125",
  "",
  "**What to Review**",
  "- The date filter query.",
].join("\r\n");

/**
 * Board modelled on task 125: two sub-issues closed by squash-merged pull
 * requests, a second task filed with the issue form, and a sub-issue whose
 * parent task is not on the board.
 */
export function makeBoard(): GhBoard {
  return {
    title: "Delivery",
    url: "https://github.com/orgs/acme/projects/5",
    items: [
      {
        issue: makeIssue(WM, 125, {
          title: "Web - Order history",
          body: HAND_WRITTEN_TASK_BODY,
          labels: ["CR"],
          issueFields: { Priority: "Urgent" },
        }),
        status: "Done",
        fields: { Module: "Orders", System: "Web" },
      },
      {
        issue: makeIssue(WEB, 173, {
          title: "Web - Order history - Client",
          parentKey: `${WM}#125`,
          body: "See the task.",
          closingPullRequests: [{ key: `${WEB}#175`, repository: WEB, mergeCommitSha: "sha175" }],
        }),
        status: "Done",
        fields: {},
      },
      {
        issue: makeIssue(API, 60, {
          title: "Web - Order history - API",
          parentKey: `${WM}#125`,
          closingPullRequests: [{ key: `${API}#62`, repository: API, mergeCommitSha: "sha62" }],
        }),
        status: "Done",
        fields: {},
      },
      {
        issue: makeIssue(WM, 200, {
          title: "Web - Printable invoices",
          body: FORM_TASK_BODY,
          labels: ["CR"],
          state: "OPEN",
          stateReason: null,
          closedAt: null,
        }),
        status: "In Progress",
        fields: { Module: "Billing" },
      },
      {
        issue: makeIssue(WEB, 300, {
          title: "Orphan - Client",
          parentKey: `${WM}#999`,
          closingPullRequests: [{ key: `${WEB}#301`, repository: WEB, mergeCommitSha: "sha301" }],
        }),
        status: "Done",
        fields: {},
      },
    ],
  };
}

export class FakeWorkTrackingClient implements WorkTrackingClient {
  public readonly calls = {
    board: 0,
    issues: [] as string[][],
    pulls: [] as string[][],
    commitPulls: [] as CommitRef[][],
  };

  public constructor(
    public board: GhBoard = makeBoard(),
    public issues: Map<string, GhIssue> = new Map([
      [`${WM}#999`, makeIssue(WM, 999, { title: "Off-board task" })],
    ]),
    public pulls: Map<string, GhPullRequest> = new Map([
      [`${WEB}#175`, makePull(WEB, 175, { mergeCommitSha: "sha175", body: PR_BODY, closingIssues: [`${WEB}#173`] })],
      [`${API}#62`, makePull(API, 62, { mergeCommitSha: "sha62" })],
      [`${WEB}#301`, makePull(WEB, 301, { mergeCommitSha: "sha301" })],
    ]),
    public commitPulls: Map<string, GhPullRequest[]> = new Map(),
    public failCommitPullsFor: Set<string> = new Set(),
  ) {}

  public async getProjectBoard(): Promise<GhBoard> {
    this.calls.board += 1;
    return this.board;
  }

  public async getIssuesBatch(keys: string[]): Promise<Map<string, GhIssue | null>> {
    this.calls.issues.push(keys);
    return new Map(keys.map((key) => [key, this.issues.get(key) ?? null]));
  }

  public async getPullRequestsBatch(keys: string[]): Promise<Map<string, GhPullRequest | null>> {
    this.calls.pulls.push(keys);
    return new Map(keys.map((key) => [key, this.pulls.get(key) ?? null]));
  }

  public async getCommitPullRequestsBatch(commits: CommitRef[]): Promise<Map<string, GhPullRequest[]>> {
    this.calls.commitPulls.push(commits);
    if (commits.some((commit) => this.failCommitPullsFor.has(commit.repository))) {
      throw new Error("502 bad gateway");
    }
    return new Map(
      commits.map((commit) => {
        const key = repositoryShaKey(commit.repository, commit.sha);
        return [key, this.commitPulls.get(key) ?? []];
      }),
    );
  }
}
