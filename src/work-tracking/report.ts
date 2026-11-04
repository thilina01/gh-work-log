/**
 * Builds the `workTracking` report section from the linked commits. Records
 * are keyed by `owner/repo#number` and emitted in deterministic order. Only
 * tasks that scanned commits link to are included, together with all of
 * their sub-issues on the board and the pull requests the commits link to.
 */

import { CommitRecord } from "../types";
import { IndexedIssue, resolveHierarchy, WorkIndex } from "./link";
import { cleanText, compareIssueKeys, parseBody, parseTrailers } from "./text";
import {
  GhBoard,
  GhPullRequest,
  TaskDetailLevel,
  WORK_LINK_SOURCES,
  WORK_UNLINKED_REASONS,
  WorkLinkSource,
  WorkPullRequest,
  WorkSubIssue,
  WorkTask,
  WorkTaskActivity,
  WorkTrackingCoverage,
  WorkTrackingReport,
  WorkTrackingSettings,
  WorkUnlinkedReason,
} from "./types";

export function buildWorkTrackingReport(params: {
  board: GhBoard;
  settings: WorkTrackingSettings;
  taskDetail: TaskDetailLevel;
  index: WorkIndex;
  commits: CommitRecord[];
  pullRecords: Map<string, GhPullRequest>;
  includeDiffStats: boolean;
  snapshotAt: string;
}): WorkTrackingReport {
  const { index, settings, taskDetail } = params;
  const linkedCommits = params.commits.filter((commit) => commit.workLink?.status === "linked");
  const commitsByTask = new Map<string, CommitRecord[]>();
  for (const commit of linkedCommits) {
    const task = commit.workLink?.task;
    if (task) {
      commitsByTask.set(task, [...(commitsByTask.get(task) ?? []), commit]);
    }
  }

  const children = new Map<string, string[]>();
  for (const [key, entry] of index.issues) {
    const parent = entry.issue.parentKey;
    if (parent) {
      children.set(parent, [...(children.get(parent) ?? []), key]);
    }
  }

  const pullLinks = new Map<string, { task: string | null; subIssue: string | null }>();
  for (const commit of params.commits) {
    const link = commit.workLink;
    if (link?.pullRequest && !pullLinks.has(link.pullRequest)) {
      pullLinks.set(link.pullRequest, { task: link.task, subIssue: link.subIssue });
    }
  }
  const pullKeys = Array.from(pullLinks.keys())
    .filter((key) => params.pullRecords.has(key))
    .sort(compareIssueKeys);

  const subIssues: Record<string, WorkSubIssue> = {};
  const tasks: Record<string, WorkTask> = {};
  for (const taskKey of Array.from(commitsByTask.keys()).sort(compareIssueKeys)) {
    const entry = index.issues.get(taskKey);
    if (!entry) {
      continue;
    }
    const descendants = collectDescendants(taskKey, children).sort(compareIssueKeys);
    for (const key of descendants) {
      const subEntry = index.issues.get(key);
      if (subEntry) {
        subIssues[key] = buildSubIssue(subEntry, taskKey, taskDetail, index);
      }
    }
    const taskPulls = pullKeys.filter((key) => pullLinks.get(key)?.task === taskKey);
    tasks[taskKey] = buildTask({
      entry,
      subIssueKeys: descendants,
      pullRequests: taskPulls,
      commits: commitsByTask.get(taskKey) ?? [],
      settings,
      taskDetail,
      includeDiffStats: params.includeDiffStats,
      index,
    });
  }

  const sortedSubIssues: Record<string, WorkSubIssue> = {};
  for (const key of Object.keys(subIssues).sort(compareIssueKeys)) {
    const value = subIssues[key];
    if (value) {
      sortedSubIssues[key] = value;
    }
  }

  const pullRequests: Record<string, WorkPullRequest> = {};
  for (const key of pullKeys) {
    const pull = params.pullRecords.get(key);
    if (pull) {
      pullRequests[key] = buildPullRequest(pull, pullLinks.get(key) ?? { task: null, subIssue: null }, settings, taskDetail);
    }
  }

  return {
    board: {
      owner: settings.project.owner,
      number: settings.project.number,
      title: params.board.title,
      url: params.board.url,
      itemCount: params.board.items.length,
      snapshotAt: params.snapshotAt,
    },
    taskDetail,
    settings,
    coverage: buildCoverage(params.commits),
    tasks,
    subIssues: sortedSubIssues,
    pullRequests,
  };
}

function buildTask(params: {
  entry: IndexedIssue;
  subIssueKeys: string[];
  pullRequests: string[];
  commits: CommitRecord[];
  settings: WorkTrackingSettings;
  taskDetail: TaskDetailLevel;
  includeDiffStats: boolean;
  index: WorkIndex;
}): WorkTask {
  const { entry, settings, taskDetail } = params;
  const issue = entry.issue;
  const completeness: string[] = [];
  if (!entry.onBoard) {
    completeness.push("not_on_board");
  }
  const parsed = parseBody(issue.body, { sections: settings.taskSections, fields: settings.taskFields });
  let textDetail: Pick<WorkTask, "fields" | "sections" | "body"> = {};
  if (taskDetail !== "none") {
    textDetail = { fields: parsed.fields };
  }
  if (taskDetail === "full") {
    if (Object.keys(parsed.sections).length > 0) {
      textDetail.sections = parsed.sections;
    } else {
      const body = cleanText(issue.body);
      if (body) {
        textDetail.body = body;
        if (settings.taskSections.length > 0) {
          completeness.push("sections_not_found");
        }
      } else {
        completeness.push("body_empty");
      }
    }
  }
  const hasOutsidePulls = params.subIssueKeys.some((key) =>
    params.index.issues.get(key)?.issue.closingPullRequests.some((pull) => !params.pullRequests.includes(pull.key)),
  );
  if (hasOutsidePulls) {
    completeness.push("pull_requests_outside_scan");
  }

  return {
    key: issue.key,
    repository: issue.repository,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    stateReason: issue.stateReason,
    issueType: issue.issueType,
    labels: issue.labels,
    assignees: issue.assignees,
    milestone: issue.milestone,
    createdAt: issue.createdAt,
    closedAt: issue.closedAt,
    onBoard: entry.onBoard,
    status: entry.status,
    boardFields: sortRecord(entry.boardFields),
    issueFields: sortRecord(issue.issueFields),
    ...textDetail,
    subIssues: params.subIssueKeys,
    pullRequests: params.pullRequests,
    activity: buildActivity(params.commits, params.includeDiffStats),
    completeness,
  };
}

function buildSubIssue(
  entry: IndexedIssue,
  task: string,
  taskDetail: TaskDetailLevel,
  index: WorkIndex,
): WorkSubIssue {
  const issue = entry.issue;
  const body = taskDetail === "full" ? cleanText(issue.body) : "";
  return {
    key: issue.key,
    repository: issue.repository,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    stateReason: issue.stateReason,
    assignees: issue.assignees,
    createdAt: issue.createdAt,
    closedAt: issue.closedAt,
    onBoard: entry.onBoard,
    status: entry.status,
    task: resolveHierarchy(issue.key, index)?.task ?? task,
    parent: issue.parentKey ?? task,
    closingPullRequests: issue.closingPullRequests.map((pull) => pull.key).sort(compareIssueKeys),
    ...(body ? { body } : {}),
  };
}

function buildPullRequest(
  pull: GhPullRequest,
  link: { task: string | null; subIssue: string | null },
  settings: WorkTrackingSettings,
  taskDetail: TaskDetailLevel,
): WorkPullRequest {
  const trailerNames = [settings.taskTrailer, settings.subIssueTrailer].filter(
    (name): name is string => Boolean(name),
  );
  const stripLines = [
    /^\s*(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+\S*#\d+\s*$/i,
    ...trailerNames.map((name) => new RegExp(`^\\s*${escapeRegExp(name)}\\s*:`, "i")),
  ];
  const sections =
    taskDetail === "full"
      ? parseBody(pull.body, { sections: settings.pullRequestSections, fields: [], stripLines }).sections
      : null;

  return {
    key: pull.key,
    repository: pull.repository,
    number: pull.number,
    title: pull.title,
    url: pull.url,
    state: pull.state,
    isDraft: pull.isDraft,
    createdAt: pull.createdAt,
    mergedAt: pull.mergedAt,
    closedAt: pull.closedAt,
    author: pull.author,
    mergedBy: pull.mergedBy,
    headRefName: pull.headRefName,
    baseRefName: pull.baseRefName,
    mergeCommitSha: pull.mergeCommitSha,
    additions: pull.additions,
    deletions: pull.deletions,
    changedFiles: pull.changedFiles,
    commitCount: pull.commitCount,
    labels: pull.labels,
    reviews: [...pull.reviews].sort(
      (left, right) =>
        (left.submittedAt ?? "").localeCompare(right.submittedAt ?? "") ||
        (left.author ?? "").localeCompare(right.author ?? ""),
    ),
    closingIssues: [...pull.closingIssues].sort(compareIssueKeys),
    task: link.task,
    subIssue: link.subIssue,
    trailers: parseTrailers(pull.body, trailerNames),
    ...(sections ? { sections } : {}),
  };
}

function buildActivity(commits: CommitRecord[], includeDiffStats: boolean): WorkTaskActivity | null {
  if (commits.length === 0) {
    return null;
  }
  const dates = commits.map((commit) => commit.authoredDateTime).sort();
  const authors = new Map<string | null, number>();
  for (const commit of commits) {
    authors.set(commit.authorLogin, (authors.get(commit.authorLogin) ?? 0) + 1);
  }
  const activity: WorkTaskActivity = {
    commitCount: commits.length,
    repositories: Array.from(new Set(commits.map((commit) => commit.repository))).sort((left, right) =>
      left.localeCompare(right),
    ),
    firstCommitAt: dates[0] ?? "",
    lastCommitAt: dates[dates.length - 1] ?? "",
    authors: Array.from(authors.entries())
      .map(([login, commitCount]) => ({ login, commitCount }))
      .sort(
        (left, right) =>
          right.commitCount - left.commitCount || (left.login ?? "").localeCompare(right.login ?? ""),
      ),
  };
  if (includeDiffStats) {
    activity.additions = commits.reduce((sum, commit) => sum + (commit.additions ?? 0), 0);
    activity.deletions = commits.reduce((sum, commit) => sum + (commit.deletions ?? 0), 0);
  }
  return activity;
}

function buildCoverage(commits: CommitRecord[]): WorkTrackingCoverage {
  const linkedBySource = Object.fromEntries(WORK_LINK_SOURCES.map((source) => [source, 0])) as Record<
    WorkLinkSource,
    number
  >;
  const unlinkedByReason = Object.fromEntries(WORK_UNLINKED_REASONS.map((reason) => [reason, 0])) as Record<
    WorkUnlinkedReason,
    number
  >;
  let linked = 0;
  for (const commit of commits) {
    const link = commit.workLink;
    if (link?.status === "linked" && link.linkSource) {
      linked += 1;
      linkedBySource[link.linkSource] += 1;
    } else if (link?.unlinkedReason) {
      unlinkedByReason[link.unlinkedReason] += 1;
    }
  }
  return { commits: commits.length, linked, unlinked: commits.length - linked, linkedBySource, unlinkedByReason };
}

function collectDescendants(task: string, children: Map<string, string[]>): string[] {
  const result: string[] = [];
  const queue = [...(children.get(task) ?? [])];
  const seen = new Set<string>([task]);
  while (queue.length > 0) {
    const key = queue.shift() as string;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(key);
    queue.push(...(children.get(key) ?? []));
  }
  return result;
}

function sortRecord<T>(value: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    sorted[key] = value[key] as T;
  }
  return sorted;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
