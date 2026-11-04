/**
 * Pure linking logic: builds lookup tables from the board, proposes candidate
 * issues for each commit in priority order, and resolves an issue to its
 * task (top-level ancestor) and sub-issue.
 */

import { CommitRecord } from "../types";
import { repositoryShaKey } from "../utils/collections";
import { matchBranchNumber, issueKey, parseIssueReference, parseTrailers } from "./text";
import {
  FieldValue,
  GhBoard,
  GhIssue,
  GhPullRequest,
  WorkLinkConfidence,
  WorkLinkSource,
  WorkTrackingSettings,
  WorkUnlinkedReason,
} from "./types";

export interface IndexedIssue {
  issue: GhIssue;
  onBoard: boolean;
  status: string | null;
  boardFields: Record<string, FieldValue>;
}

export interface WorkIndex {
  issues: Map<string, IndexedIssue>;
  /** `repository:sha` of a merge commit -> the pull request and the issues it closed. */
  mergeCommits: Map<string, { pullRequest: string; issues: string[] }>;
}

export function buildWorkIndex(board: GhBoard): WorkIndex {
  const issues = new Map<string, IndexedIssue>();
  for (const item of board.items) {
    issues.set(item.issue.key, {
      issue: item.issue,
      onBoard: true,
      status: item.status,
      boardFields: item.fields,
    });
  }
  const index: WorkIndex = { issues, mergeCommits: new Map() };
  for (const entry of issues.values()) {
    indexMergeCommits(index, entry.issue);
  }
  return index;
}

/** Adds an issue fetched outside the board (for example a parent task that is not on the board). */
export function addIssueToIndex(index: WorkIndex, issue: GhIssue): void {
  if (index.issues.has(issue.key)) {
    return;
  }
  index.issues.set(issue.key, { issue, onBoard: false, status: null, boardFields: {} });
  indexMergeCommits(index, issue);
}

function indexMergeCommits(index: WorkIndex, issue: GhIssue): void {
  for (const pull of issue.closingPullRequests) {
    if (!pull.mergeCommitSha) {
      continue;
    }
    const key = repositoryShaKey(pull.repository, pull.mergeCommitSha);
    const existing = index.mergeCommits.get(key);
    if (existing) {
      if (!existing.issues.includes(issue.key)) {
        existing.issues.push(issue.key);
      }
    } else {
      index.mergeCommits.set(key, { pullRequest: pull.key, issues: [issue.key] });
    }
  }
}

export interface Candidate {
  issue: string;
  source: WorkLinkSource;
  confidence: WorkLinkConfidence;
}

/** How a commit will be linked, before candidate issues are resolved. */
export interface CommitPlan {
  commit: CommitRecord;
  pullRequest: string | null;
  candidates: Candidate[];
  /** Reason to report if no candidate resolves. */
  fallbackReason: WorkUnlinkedReason;
}

export interface LinkContext {
  settings: WorkTrackingSettings;
  branchPattern: RegExp | null;
  index: WorkIndex;
}

/** The commit's merge-commit match on the board, if any. */
export function planFromMergeSha(commit: CommitRecord, context: LinkContext): CommitPlan | null {
  const match = context.index.mergeCommits.get(repositoryShaKey(commit.repository, commit.sha));
  if (!match) {
    return null;
  }
  return {
    commit,
    pullRequest: match.pullRequest,
    candidates: sortByBoardPresence(match.issues, context.index).map((issue) => ({
      issue,
      source: "merge_sha",
      confidence: "high",
    })),
    fallbackReason: "pull_request_without_task",
  };
}

/** Whether a commit with no merge-commit match is skipped before any lookup, and why. */
export function scopeReason(commit: CommitRecord, settings: WorkTrackingSettings): WorkUnlinkedReason | null {
  const owner = commit.repository.split("/")[0] ?? "";
  if (!settings.repositoryOwners.some((candidate) => candidate.toLowerCase() === owner.toLowerCase())) {
    return "out_of_scope_repository";
  }
  if (settings.exemptRepositories.some((repository) => repository.toLowerCase() === commit.repository.toLowerCase())) {
    return "exempt_repository";
  }
  return null;
}

/** Picks the pull request that best represents a commit among its associated pull requests. */
export function choosePullRequest(commit: CommitRecord, pulls: GhPullRequest[]): GhPullRequest | null {
  const sameRepository = pulls.filter((pull) => pull.repository === commit.repository);
  const pool = sameRepository.length > 0 ? sameRepository : pulls;
  return (
    pool.find((pull) => pull.mergeCommitSha === commit.sha) ??
    [...pool]
      .filter((pull) => pull.state === "MERGED")
      .sort((left, right) => (left.mergedAt ?? "").localeCompare(right.mergedAt ?? ""))[0] ??
    pool.find((pull) => pull.state === "OPEN") ??
    pool[0] ??
    null
  );
}

/** Candidates from a pull request: closing references, then trailers, then its branch name. */
export function pullRequestCandidates(pull: GhPullRequest, context: LinkContext): Candidate[] {
  const candidates: Candidate[] = [];
  for (const issue of sortByBoardPresence(pull.closingIssues, context.index)) {
    candidates.push({ issue, source: "pr_closing_ref", confidence: "high" });
  }
  // A bare `#N` in the sub-issue trailer is in the pull request's repository
  // (GitHub's rule); in the task trailer it names a task in `taskRepository`.
  const trailerContexts: Array<[string | null, string | null]> = [
    [context.settings.subIssueTrailer, pull.repository],
    [context.settings.taskTrailer, context.settings.taskRepository ?? pull.repository],
  ];
  const trailerNames = trailerContexts.flatMap(([name]) => (name ? [name] : []));
  if (trailerNames.length > 0) {
    const trailers = parseTrailers(pull.body, trailerNames);
    for (const [name, repository] of trailerContexts) {
      const value = name ? trailers[name] : undefined;
      const reference = value ? parseIssueReference(value, repository) : null;
      if (reference) {
        candidates.push({ issue: reference, source: "pr_trailer", confidence: "high" });
      }
    }
  }
  const fromBranch = branchCandidate(pull.headRefName, context);
  if (fromBranch) {
    candidates.push({ ...fromBranch, source: "pr_branch" });
  }
  return dedupeCandidates(candidates);
}

/** Candidates from the branches a commit was observed on (unmerged work). */
export function branchCandidates(commit: CommitRecord, context: LinkContext): Candidate[] {
  const branches = Array.from(new Set([commit.branch, commit.scanBranch, ...(commit.observedBranches ?? [])]));
  return dedupeCandidates(
    branches.flatMap((branch) => {
      const candidate = branchCandidate(branch, context);
      return candidate ? [candidate] : [];
    }),
  );
}

function branchCandidate(branch: string, context: LinkContext): Candidate | null {
  if (!context.settings.taskRepository) {
    return null;
  }
  const number = matchBranchNumber(branch, context.branchPattern);
  return number === null
    ? null
    : { issue: issueKey(context.settings.taskRepository, number), source: "branch_name", confidence: "medium" };
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.issue)) {
      return false;
    }
    seen.add(candidate.issue);
    return true;
  });
}

function sortByBoardPresence(keys: string[], index: WorkIndex): string[] {
  return [...keys].sort((left, right) => {
    const leftOnBoard = index.issues.get(left)?.onBoard ? 0 : 1;
    const rightOnBoard = index.issues.get(right)?.onBoard ? 0 : 1;
    return leftOnBoard - rightOnBoard || left.localeCompare(right);
  });
}

/**
 * Keys that must be fetched before `issue` can be resolved: the issue itself
 * or its first ancestor missing from the index. Returns null when the chain
 * is complete or a fetch already failed (`unresolvable`).
 */
export function missingAncestor(issue: string, index: WorkIndex, unresolvable: Set<string>): string | null {
  let current: string | null = issue;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (unresolvable.has(current)) {
      return null;
    }
    const entry = index.issues.get(current);
    if (!entry) {
      return current;
    }
    current = entry.issue.parentKey;
  }
  return null;
}

/**
 * Resolves an issue to its task (top-level ancestor) and sub-issue (the issue
 * itself when it has a parent). Returns null when the issue is not known.
 * A parent that could not be fetched ends the chain at the last known issue.
 */
export function resolveHierarchy(
  issue: string,
  index: WorkIndex,
): { task: string; subIssue: string | null } | null {
  const entry = index.issues.get(issue);
  if (!entry) {
    return null;
  }
  let task = issue;
  const seen = new Set<string>([issue]);
  let parent = entry.issue.parentKey;
  while (parent && !seen.has(parent) && index.issues.has(parent)) {
    seen.add(parent);
    task = parent;
    parent = index.issues.get(parent)?.issue.parentKey ?? null;
  }
  return { task, subIssue: task === issue ? null : issue };
}
