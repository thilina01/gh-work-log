/**
 * Work-tracking enrichment: links scanned commits to board tasks and builds
 * the report's `workTracking` section.
 *
 * Linking order per commit:
 * 1. merge_sha  - the commit is the merge commit of a pull request that
 *                 closed an issue on the board (no extra requests);
 * 2. pull request lookup (batched) - closing references, trailer lines, then
 *                 the pull request's branch name;
 * 3. branch_name - the task number in a branch the commit was observed on.
 */

import { toFailure } from "../app/failure";
import { Logger } from "../logger";
import { CommitRecord, FailureRecord } from "../types";
import { mapLimit } from "../utils/async";
import { groupBy, repositoryShaKey } from "../utils/collections";
import { toErrorMessage } from "../utils/errors";
import {
  addIssueToIndex,
  branchCandidates,
  buildWorkIndex,
  choosePullRequest,
  CommitPlan,
  LinkContext,
  missingAncestor,
  planFromMergeSha,
  pullRequestCandidates,
  resolveHierarchy,
  scopeReason,
} from "./link";
import { buildWorkTrackingReport } from "./report";
import { parseIssueKey } from "./text";
import {
  CommitWorkLink,
  GhBoard,
  GhPullRequest,
  TaskDetailLevel,
  WorkTrackingClient,
  WorkTrackingReport,
  WorkTrackingSettings,
} from "./types";

const BATCH_SIZE = 20;
const MAX_ANCESTOR_ROUNDS = 4;
const FAILURE_STAGE = "work_tracking";

export async function enrichWorkTracking(params: {
  commits: CommitRecord[];
  board: GhBoard;
  settings: WorkTrackingSettings;
  taskDetail: TaskDetailLevel;
  includeDiffStats: boolean;
  client: WorkTrackingClient;
  concurrency: number;
  snapshotAt: string;
  logger: Logger;
}): Promise<{ report: WorkTrackingReport; failures: FailureRecord[] }> {
  const { settings, client, logger } = params;
  const failures: FailureRecord[] = [];
  const index = buildWorkIndex(params.board);
  const context: LinkContext = {
    settings,
    branchPattern: settings.branchTaskPattern ? new RegExp(settings.branchTaskPattern) : null,
    index,
  };
  const pullRecords = new Map<string, GhPullRequest>();
  const plans = new Map<string, CommitPlan>();
  const needLookup: CommitRecord[] = [];

  for (const commit of params.commits) {
    const key = repositoryShaKey(commit.repository, commit.sha);
    const fromMerge = planFromMergeSha(commit, context);
    if (fromMerge) {
      plans.set(key, fromMerge);
      continue;
    }
    const reason = scopeReason(commit, settings);
    if (reason) {
      plans.set(key, { commit, pullRequest: null, candidates: [], fallbackReason: reason });
      continue;
    }
    needLookup.push(commit);
  }

  logger.info(
    `Work tracking: ${plans.size - countSkipped(plans)} commits matched by merge commit, ${needLookup.length} need a pull request lookup`,
  );

  await mapLimit(batchByRepository(needLookup, (commit) => commit.repository), params.concurrency, async (batch) => {
    try {
      const results = await client.getCommitPullRequestsBatch(
        batch.map((commit) => ({ repository: commit.repository, sha: commit.sha })),
      );
      for (const commit of batch) {
        const pulls = results.get(repositoryShaKey(commit.repository, commit.sha)) ?? [];
        for (const pull of pulls) {
          pullRecords.set(pull.key, pull);
        }
        const pull = choosePullRequest(commit, pulls);
        const candidates = [
          ...(pull ? pullRequestCandidates(pull, context) : []),
          ...branchCandidates(commit, context),
        ];
        plans.set(repositoryShaKey(commit.repository, commit.sha), {
          commit,
          pullRequest: pull?.key ?? null,
          candidates: candidates.filter(
            (candidate, position) => candidates.findIndex((other) => other.issue === candidate.issue) === position,
          ),
          fallbackReason: pull ? "pull_request_without_task" : "no_pull_request",
        });
      }
    } catch (error) {
      logger.info(`Work tracking: pull request lookup failed for ${batch[0]?.repository}: ${toErrorMessage(error)}`);
      failures.push(toFailure(error, batch[0]?.repository ?? "", FAILURE_STAGE));
      for (const commit of batch) {
        plans.set(repositoryShaKey(commit.repository, commit.sha), {
          commit,
          pullRequest: null,
          candidates: branchCandidates(commit, context),
          fallbackReason: "lookup_failed",
        });
      }
    }
  });

  await fetchMissingIssues(Array.from(plans.values()), context, client, params.concurrency, failures, logger);

  for (const commit of params.commits) {
    const plan = plans.get(repositoryShaKey(commit.repository, commit.sha));
    commit.workLink = plan ? resolvePlan(plan, context) : unlinked(null, "lookup_failed");
  }

  const referencedPulls = Array.from(
    new Set(
      params.commits.flatMap((commit) => (commit.workLink?.pullRequest ? [commit.workLink.pullRequest] : [])),
    ),
  );
  const missingPulls = referencedPulls.filter((key) => !pullRecords.has(key));
  await mapLimit(batchByRepository(missingPulls, repositoryOfKey), params.concurrency, async (batch) => {
    try {
      const results = await client.getPullRequestsBatch(batch);
      for (const [key, pull] of results) {
        if (pull) {
          pullRecords.set(key, pull);
        }
      }
    } catch (error) {
      logger.info(`Work tracking: pull request details failed for ${repositoryOfKey(batch[0] ?? "")}: ${toErrorMessage(error)}`);
      failures.push(toFailure(error, repositoryOfKey(batch[0] ?? ""), FAILURE_STAGE));
    }
  });

  const report = buildWorkTrackingReport({
    board: params.board,
    settings,
    taskDetail: params.taskDetail,
    index,
    commits: params.commits,
    pullRecords,
    includeDiffStats: params.includeDiffStats,
    snapshotAt: params.snapshotAt,
  });
  logger.info(
    `Work tracking: ${report.coverage.linked} of ${report.coverage.commits} commits linked to ${Object.keys(report.tasks).length} tasks`,
  );
  return { report, failures };
}

/** Fetches candidate issues and their ancestors that are not on the board. */
async function fetchMissingIssues(
  plans: CommitPlan[],
  context: LinkContext,
  client: WorkTrackingClient,
  concurrency: number,
  failures: FailureRecord[],
  logger: Logger,
): Promise<void> {
  const unresolvable = new Set<string>();
  for (let round = 0; round < MAX_ANCESTOR_ROUNDS; round += 1) {
    const missing = new Set<string>();
    for (const plan of plans) {
      for (const candidate of plan.candidates) {
        const key = missingAncestor(candidate.issue, context.index, unresolvable);
        if (key) {
          missing.add(key);
        }
      }
    }
    if (missing.size === 0) {
      return;
    }
    await mapLimit(batchByRepository(Array.from(missing), repositoryOfKey), concurrency, async (batch) => {
      try {
        const results = await client.getIssuesBatch(batch);
        for (const key of batch) {
          const issue = results.get(key);
          if (issue) {
            addIssueToIndex(context.index, issue);
          } else {
            unresolvable.add(key);
          }
        }
      } catch (error) {
        logger.info(`Work tracking: issue lookup failed for ${repositoryOfKey(batch[0] ?? "")}: ${toErrorMessage(error)}`);
        failures.push(toFailure(error, repositoryOfKey(batch[0] ?? ""), FAILURE_STAGE));
        for (const key of batch) {
          unresolvable.add(key);
        }
      }
    });
  }
}

function resolvePlan(plan: CommitPlan, context: LinkContext): CommitWorkLink {
  for (const candidate of plan.candidates) {
    const resolved = resolveHierarchy(candidate.issue, context.index);
    if (!resolved) {
      continue;
    }
    const taskOnBoard = context.index.issues.get(resolved.task)?.onBoard ?? false;
    return {
      status: "linked",
      task: resolved.task,
      subIssue: resolved.subIssue,
      pullRequest: plan.pullRequest,
      linkSource: candidate.source,
      confidence: taskOnBoard ? candidate.confidence : "medium",
      unlinkedReason: null,
    };
  }
  return unlinked(plan.pullRequest, plan.fallbackReason);
}

function unlinked(pullRequest: string | null, reason: CommitWorkLink["unlinkedReason"]): CommitWorkLink {
  return {
    status: "unlinked",
    task: null,
    subIssue: null,
    pullRequest,
    linkSource: null,
    confidence: null,
    unlinkedReason: reason,
  };
}

function countSkipped(plans: Map<string, CommitPlan>): number {
  let count = 0;
  for (const plan of plans.values()) {
    if (plan.candidates.length === 0) {
      count += 1;
    }
  }
  return count;
}

function batchByRepository<T>(items: T[], repositoryOf: (item: T) => string): T[][] {
  const batches: T[][] = [];
  const grouped = groupBy(items, repositoryOf);
  for (const repository of Array.from(grouped.keys()).sort((left, right) => left.localeCompare(right))) {
    const group = grouped.get(repository) ?? [];
    for (let start = 0; start < group.length; start += BATCH_SIZE) {
      batches.push(group.slice(start, start + BATCH_SIZE));
    }
  }
  return batches;
}

function repositoryOfKey(key: string): string {
  return parseIssueKey(key)?.repository ?? "";
}
