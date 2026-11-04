/**
 * Types for the optional work-tracking enrichment (`--enrich-tasks`), which
 * links scanned commits to issues tracked on a GitHub Projects board.
 *
 * Terminology is generic: a "task" is the top-level issue of a hierarchy
 * (an issue with no parent), and a "sub-issue" is any issue with a parent.
 */

export type TaskDetailLevel = "none" | "summary" | "full";

export type ProjectOwnerType = "organization" | "user";

/** Shape of the `workTracking` block in the local config file. */
export interface WorkTrackingLocalConfig {
  projectOwner?: string;
  projectOwnerType?: string;
  projectNumber?: number;
  taskRepository?: string;
  repositoryOwners?: string[];
  exemptRepositories?: string[];
  branchTaskPattern?: string;
  taskTrailer?: string;
  subIssueTrailer?: string;
  taskSections?: string[];
  taskFields?: string[];
  pullRequestSections?: string[];
}

export interface WorkTrackingSettings {
  project: {
    ownerType: ProjectOwnerType;
    owner: string;
    number: number;
  };
  /** Repository that bare task numbers (from branch names) resolve against. */
  taskRepository: string | null;
  /** Repository owners whose commits are linked; others are out of scope. */
  repositoryOwners: string[];
  exemptRepositories: string[];
  /** Regex source with one capture group for the task number. */
  branchTaskPattern: string | null;
  taskTrailer: string | null;
  subIssueTrailer: string | null;
  taskSections: string[];
  taskFields: string[];
  pullRequestSections: string[];
}

export type WorkLinkSource =
  | "merge_sha"
  | "pr_closing_ref"
  | "pr_trailer"
  | "pr_branch"
  | "branch_name";

export type WorkLinkConfidence = "high" | "medium";

export type WorkUnlinkedReason =
  | "out_of_scope_repository"
  | "exempt_repository"
  | "no_pull_request"
  | "pull_request_without_task"
  | "lookup_failed";

export const WORK_LINK_SOURCES: readonly WorkLinkSource[] = [
  "merge_sha",
  "pr_closing_ref",
  "pr_trailer",
  "pr_branch",
  "branch_name",
];

export const WORK_UNLINKED_REASONS: readonly WorkUnlinkedReason[] = [
  "out_of_scope_repository",
  "exempt_repository",
  "no_pull_request",
  "pull_request_without_task",
  "lookup_failed",
];

/** Present on every commit when `--enrich-tasks` is enabled. */
export interface CommitWorkLink {
  status: "linked" | "unlinked";
  task: string | null;
  subIssue: string | null;
  pullRequest: string | null;
  linkSource: WorkLinkSource | null;
  confidence: WorkLinkConfidence | null;
  unlinkedReason: WorkUnlinkedReason | null;
}

export type FieldValue = string | number;

export interface WorkTaskActivity {
  commitCount: number;
  repositories: string[];
  firstCommitAt: string;
  lastCommitAt: string;
  additions?: number;
  deletions?: number;
  authors: Array<{ login: string | null; commitCount: number }>;
}

export interface WorkTask {
  key: string;
  repository: string;
  number: number;
  title: string;
  url: string;
  state: string;
  stateReason: string | null;
  issueType: string | null;
  labels: string[];
  assignees: string[];
  milestone: string | null;
  createdAt: string;
  closedAt: string | null;
  onBoard: boolean;
  /** Board Status at `workTracking.board.snapshotAt`, not at `metadata.until`. */
  status: string | null;
  /** Other board fields (single select, text, number, date, iteration). */
  boardFields: Record<string, FieldValue>;
  /** Organization issue fields, such as Priority. */
  issueFields: Record<string, FieldValue>;
  /** Configured `taskFields` (for example "Requested by"); summary and full detail. */
  fields?: Record<string, string>;
  /** Configured `taskSections`; full detail only. */
  sections?: Record<string, string>;
  /** Cleaned body when no configured section was found; full detail only. */
  body?: string;
  subIssues: string[];
  pullRequests: string[];
  activity: WorkTaskActivity | null;
  completeness: string[];
}

export interface WorkSubIssue {
  key: string;
  repository: string;
  number: number;
  title: string;
  url: string;
  state: string;
  stateReason: string | null;
  assignees: string[];
  createdAt: string;
  closedAt: string | null;
  onBoard: boolean;
  status: string | null;
  task: string;
  parent: string;
  closingPullRequests: string[];
  /** Cleaned body; full detail only, omitted when empty. */
  body?: string;
}

export interface WorkPullRequestReview {
  author: string | null;
  state: string;
  submittedAt: string | null;
}

export interface WorkPullRequest {
  key: string;
  repository: string;
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  author: string | null;
  mergedBy: string | null;
  headRefName: string;
  baseRefName: string;
  mergeCommitSha: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  commitCount: number;
  labels: string[];
  reviews: WorkPullRequestReview[];
  closingIssues: string[];
  task: string | null;
  subIssue: string | null;
  trailers: Record<string, string>;
  /** Configured `pullRequestSections`; full detail only. */
  sections?: Record<string, string>;
}

export interface WorkTrackingCoverage {
  commits: number;
  linked: number;
  unlinked: number;
  linkedBySource: Record<WorkLinkSource, number>;
  unlinkedByReason: Record<WorkUnlinkedReason, number>;
}

export interface WorkTrackingReport {
  board: {
    owner: string;
    number: number;
    title: string;
    url: string;
    itemCount: number;
    snapshotAt: string;
  };
  taskDetail: TaskDetailLevel;
  /** The normalized settings this report was linked with. */
  settings: WorkTrackingSettings;
  coverage: WorkTrackingCoverage;
  tasks: Record<string, WorkTask>;
  subIssues: Record<string, WorkSubIssue>;
  pullRequests: Record<string, WorkPullRequest>;
}

// ---------------------------------------------------------------------------
// Normalized GitHub data returned by the client (internal).
// ---------------------------------------------------------------------------

export interface GhIssue {
  key: string;
  repository: string;
  number: number;
  title: string;
  url: string;
  state: string;
  stateReason: string | null;
  createdAt: string;
  closedAt: string | null;
  body: string;
  issueType: string | null;
  labels: string[];
  assignees: string[];
  milestone: string | null;
  parentKey: string | null;
  issueFields: Record<string, FieldValue>;
  closingPullRequests: Array<{ key: string; repository: string; mergeCommitSha: string | null }>;
}

export interface GhBoardItem {
  issue: GhIssue;
  status: string | null;
  fields: Record<string, FieldValue>;
}

export interface GhBoard {
  title: string;
  url: string;
  items: GhBoardItem[];
}

export interface GhPullRequest {
  key: string;
  repository: string;
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  body: string;
  author: string | null;
  mergedBy: string | null;
  headRefName: string;
  baseRefName: string;
  mergeCommitSha: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  commitCount: number;
  labels: string[];
  reviews: WorkPullRequestReview[];
  closingIssues: string[];
}

export interface CommitRef {
  repository: string;
  sha: string;
}

/** Client operations used by work tracking; each call is one GitHub request or one paginated listing. */
export interface WorkTrackingClient {
  getProjectBoard(project: WorkTrackingSettings["project"]): Promise<GhBoard>;
  /** Returns null for keys that do not resolve to an issue. */
  getIssuesBatch(keys: string[]): Promise<Map<string, GhIssue | null>>;
  getPullRequestsBatch(keys: string[]): Promise<Map<string, GhPullRequest | null>>;
  /** Keyed by `repositoryShaKey`; an empty array when a commit has no pull request. */
  getCommitPullRequestsBatch(commits: CommitRef[]): Promise<Map<string, GhPullRequest[]>>;
}
