import {
  CommitObservation,
  CommitRecord,
  FailureRecord,
  MessageCategorySummary,
  NormalizedConfig,
  ReportFilters,
  ReportHighlights,
  RepositoryRecord,
  RepositorySummary,
  RunResult,
  SkipRecord,
  SkippedByCategory,
  SkippedRepository,
  Statistics,
  TimeSeriesSummary,
} from "./types";
import { classifyMessage } from "./classification";
import { buildCandidateGroupHints } from "./hints/candidate-groups";
import { classifySkipReason } from "./skip-taxonomy";
import { readToolIdentity } from "./tool-identity";
import { groupBy, repositoryShaKey } from "./utils/collections";
import { dayKey, monthKey, roundDurationSeconds, weekStartIso } from "./utils/dates";

export function buildRunResult(params: {
  config: NormalizedConfig;
  authenticatedUser: string;
  targetAuthor: string;
  repositoriesDiscovered: number;
  repositoriesIncluded: number;
  scannedRepositoryCount: number;
  observations: CommitObservation[];
  repositoryMap: Map<string, RepositoryRecord>;
  skippedRepositories: SkipRecord[];
  failures: FailureRecord[];
  startedAtMs: number;
  endedAtMs: number;
}): RunResult {
  const commits = buildCommitRecords(
    params.observations,
    params.repositoryMap,
    params.config,
  );
  const statistics = buildStatistics({
    config: params.config,
    commits,
    observations: params.observations,
    repositoryMap: params.repositoryMap,
    failures: params.failures,
    skippedRepositories: params.skippedRepositories,
    repositoriesDiscovered: params.repositoriesDiscovered,
    repositoriesIncluded: params.repositoriesIncluded,
    scannedRepositoryCount: params.scannedRepositoryCount,
    durationSeconds: roundDurationSeconds(params.startedAtMs, params.endedAtMs),
  });

  return {
    metadata: {
      schemaVersion: "1.2.0",
      generatedAt: new Date(params.endedAtMs).toISOString(),
      authenticatedUser: params.authenticatedUser,
      targetAuthor: params.targetAuthor,
      since: params.config.sinceIso,
      until: params.config.untilIso,
      scanMode: params.config.scanFeatureBranches
        ? "default_and_feature_branches"
        : "default_branch",
      featureBranchScanEnabled: params.config.scanFeatureBranches,
      detectWip: params.config.detectWip,
      includeDiffStats: params.config.includeDiffStats,
      classifyMessages: params.config.classifyMessages,
      enrichPrs: params.config.enrichPrs,
      ignoreLocalConfig: params.config.ignoreLocalConfig,
      dryRun: params.config.dryRun,
      profile: params.config.profile,
      filters: buildReportFilters(params.config),
      filterField: "authoredDateTime",
      wipDetectionIsHeuristic: true,
      tool: readToolIdentity(),
    },
    statistics,
    failures: sortFailures(params.failures),
    data: commits,
  };
}

export function buildCommitRecords(
  observations: CommitObservation[],
  repositoryMap: Map<string, RepositoryRecord>,
  config: NormalizedConfig,
): CommitRecord[] {
  const grouped = groupBy(observations, (observation) =>
    repositoryShaKey(observation.repository, observation.sha),
  );

  const commits = Array.from(grouped.values()).map((group) => {
    const sortedObservations = [...group].sort(compareObservations);
    const first = sortedObservations[0];
    if (!first) {
      throw new Error("Cannot build a commit record from an empty observation group.");
    }
    const repository = repositoryMap.get(first.repository);
    if (!repository?.defaultBranch) {
      throw new Error(`Missing default branch for ${first.repository}.`);
    }

    const observedBranches = Array.from(
      new Set(sortedObservations.map((item) => item.scanBranch)),
    ).sort((left, right) => left.localeCompare(right));
    const observedOnDefault = observedBranches.includes(repository.defaultBranch);
    const canonicalBranch = observedOnDefault
      ? repository.defaultBranch
      : (observedBranches[0] ?? repository.defaultBranch);

    const record: CommitRecord = {
      repository: first.repository,
      branch: canonicalBranch,
      scanBranch: first.scanBranch,
      sha: first.sha,
      message: first.message,
      authoredDateTime: first.authoredDateTime,
      committedDateTime: first.committedDateTime,
      url: first.url,
      sourceMode: observedOnDefault ? "default_branch" : "feature_branch",
      authorLogin: first.authorLogin,
      authorEmail: first.authorEmail,
      isWip:
        config.detectWip &&
        canonicalBranch !== repository.defaultBranch &&
        !observedOnDefault,
      isMergeCommit: first.parentCount > 1,
      mergeIncludesExternalAuthor: first.mergeIncludesExternalAuthor,
      mergeBranchAuthorLogin: first.mergeBranchAuthorLogin,
    };

    if (config.scanFeatureBranches) {
      record.observedBranches = observedBranches;
    }

    if (record.isWip) {
      record.wipReason = "not_in_default_branch";
    }

    const diffObservation = sortedObservations.find(
      (item) => item.additions !== undefined,
    );

    if (config.includeDiffStats && diffObservation?.additions !== undefined) {
      record.additions = diffObservation.additions;
      record.deletions = diffObservation.deletions;
      record.filesChanged = diffObservation.filesChanged;
    }

    if (config.classifyMessages) {
      record.messageCategory = classifyMessage(first.message);
    }

    return record;
  });

  return commits.sort(compareCommitRecords);
}

function buildStatistics(params: {
  config: NormalizedConfig;
  commits: CommitRecord[];
  observations: CommitObservation[];
  repositoryMap: Map<string, RepositoryRecord>;
  failures: FailureRecord[];
  skippedRepositories: SkipRecord[];
  repositoriesDiscovered: number;
  repositoriesIncluded: number;
  scannedRepositoryCount: number;
  durationSeconds: number;
}): Statistics {
  const repositoriesWithCommits = new Set(params.commits.map((commit) => commit.repository));
  const failedRepositories = new Set(params.failures.map((failure) => failure.repository));
  const perRepository = buildPerRepositorySummary(
    params.commits,
    params.repositoryMap,
    params.config.scanFeatureBranches,
  );
  const timeSeries = buildTimeSeries(params.commits);

  const categorizedSkips = categorizeSkips(params.skippedRepositories);
  const skippedByCategory = countSkippedByCategory(categorizedSkips);
  const detailedSkips = packageSkippedRepositories(
    categorizedSkips,
    params.config.profile,
  );

  let codeLevel: Statistics["codeLevel"];
  if (params.config.includeDiffStats) {
    codeLevel = {
      totalAdditions: params.commits.reduce(
        (sum, commit) => sum + (commit.additions ?? 0),
        0,
      ),
      totalDeletions: params.commits.reduce(
        (sum, commit) => sum + (commit.deletions ?? 0),
        0,
      ),
      totalFilesChanged: params.commits.reduce(
        (sum, commit) => sum + (commit.filesChanged ?? 0),
        0,
      ),
    };
  }

  let messageCategories: MessageCategorySummary | undefined;
  if (params.config.classifyMessages) {
    messageCategories = params.commits.reduce<MessageCategorySummary>(
      (accumulator, commit) => {
        const category = commit.messageCategory ?? "other";
        accumulator[category] += 1;
        return accumulator;
      },
      {
        feat: 0,
        fix: 0,
        refactor: 0,
        docs: 0,
        test: 0,
        chore: 0,
        other: 0,
      },
    );
  }

  const statistics: Statistics = {
    summary: {
      repositoriesScanned: params.scannedRepositoryCount,
      repositoriesWithCommits: repositoriesWithCommits.size,
      totalCommitsCollected: params.observations.length,
      uniqueCommits: params.commits.length,
      failedRepositories: failedRepositories.size,
      skippedRepositories: skippedByCategory.filter + skippedByCategory.operational,
      durationSeconds: params.durationSeconds,
    },
    discovery: {
      repositoriesDiscovered: params.repositoriesDiscovered,
      repositoriesIncluded: params.repositoriesIncluded,
    },
    skippedByCategory,
    skippedRepositories: detailedSkips,
    highlights: buildHighlights({
      perRepository,
      commits: params.commits,
      failures: params.failures,
      skippedByCategory,
      messageCategories,
      codeLevel,
    }),
    perRepository,
    timeSeries,
  };

  if (codeLevel) {
    statistics.codeLevel = codeLevel;
  }

  if (messageCategories) {
    statistics.messageCategories = messageCategories;
  }

  if (params.config.profile === "agent") {
    statistics.hints = {
      candidateGroups: buildCandidateGroupHints(params.commits),
    };
  }

  return statistics;
}

function categorizeSkips(skips: SkipRecord[]): SkippedRepository[] {
  return skips
    .map((skip) => ({
      repository: skip.repository,
      reason: skip.reason,
      category: classifySkipReason(skip.reason),
    }))
    .sort(
      (left, right) =>
        left.repository.localeCompare(right.repository) ||
        left.reason.localeCompare(right.reason),
    );
}

function countSkippedByCategory(skips: SkippedRepository[]): SkippedByCategory {
  const skippedByCategory: SkippedByCategory = { filter: 0, operational: 0 };
  for (const skip of skips) {
    skippedByCategory[skip.category] += 1;
  }
  return skippedByCategory;
}

function packageSkippedRepositories(
  skips: SkippedRepository[],
  profile: NormalizedConfig["profile"],
): SkippedRepository[] {
  if (profile === "operator") {
    return skips;
  }

  return skips.filter((skip) => skip.category === "operational");
}

function buildReportFilters(config: NormalizedConfig): ReportFilters {
  return {
    includeOrgs: [...config.includeOrgs],
    excludeOrgs: [...config.excludeOrgs],
    includeRepos: [...config.includeRepos],
    excludeRepos: [...config.excludeRepos],
    ownedOnly: config.ownedOnly,
    branchPatterns: config.branchPatterns.map((matcher) => matcher.input),
  };
}

function buildHighlights(params: {
  perRepository: RepositorySummary[];
  commits: CommitRecord[];
  failures: FailureRecord[];
  skippedByCategory: SkippedByCategory;
  messageCategories?: MessageCategorySummary;
  codeLevel?: Statistics["codeLevel"];
}): ReportHighlights {
  const uniqueCommits = params.commits.length;
  const wipCount = params.commits.filter((commit) => commit.isWip).length;
  const topRepositories = [...params.perRepository]
    .sort((left, right) => {
      if (right.commitCount !== left.commitCount) {
        return right.commitCount - left.commitCount;
      }
      return left.repository.localeCompare(right.repository);
    })
    .slice(0, 5)
    .map((repo) => ({
      repository: repo.repository,
      commitCount: repo.commitCount,
    }));

  const highlights: ReportHighlights = {
    topRepositories,
    uniqueCommits,
    repositoriesWithCommits: new Set(params.commits.map((commit) => commit.repository)).size,
    wipShare: uniqueCommits === 0 ? 0 : wipCount / uniqueCommits,
    failureCount: params.failures.length,
    operationalSkipCount: params.skippedByCategory.operational,
    filterSkipCount: params.skippedByCategory.filter,
  };

  if (params.messageCategories) {
    highlights.messageCategoryMix = params.messageCategories;
  }

  if (params.codeLevel) {
    highlights.codeLevel = params.codeLevel;
  }

  return highlights;
}

function buildPerRepositorySummary(
  commits: CommitRecord[],
  repositoryMap: Map<string, RepositoryRecord>,
  featureBranchScanEnabled: boolean,
): RepositorySummary[] {
  const grouped = groupBy(commits, (commit) => commit.repository);

  return Array.from(grouped.entries())
    .map(([repository, repositoryCommits]) => {
      const sorted = [...repositoryCommits].sort((left, right) =>
        left.authoredDateTime.localeCompare(right.authoredDateTime),
      );

      return {
        repository,
        defaultBranch: repositoryMap.get(repository)?.defaultBranch ?? sorted[0]!.branch,
        featureBranchScanEnabled,
        commitCount: sorted.length,
        firstCommitAt: sorted[0]!.authoredDateTime,
        lastCommitAt: sorted[sorted.length - 1]!.authoredDateTime,
        wipCommitCount: sorted.filter((commit) => commit.isWip).length,
        mergeCommitCount: sorted.filter((commit) => commit.isMergeCommit).length,
        externalAuthorMergeCount: sorted.filter(
          (commit) => commit.mergeIncludesExternalAuthor,
        ).length,
      };
    })
    .sort((left, right) => left.repository.localeCompare(right.repository));
}

function buildTimeSeries(commits: CommitRecord[]): TimeSeriesSummary {
  const byDay = countBy(commits, (commit) => dayKey(commit.authoredDateTime)).map(
    ([date, commitCount]) => ({
      date,
      commitCount,
    }),
  );
  const byWeek = countBy(commits, (commit) => weekStartIso(commit.authoredDateTime)).map(
    ([weekStart, commitCount]) => ({
      weekStart,
      commitCount,
    }),
  );
  const byMonth = countBy(commits, (commit) => monthKey(commit.authoredDateTime)).map(
    ([month, commitCount]) => ({
      month,
      commitCount,
    }),
  );

  const repoBuckets = countBy(commits, (commit) => commit.repository);
  const mostActiveDay = pickMostActive(
    byDay,
    (bucket) => bucket.date ?? "",
  ) as { date: string; commitCount: number } | null;
  const mostActiveRepository = pickMostActive(
    repoBuckets.map(([repository, commitCount]) => ({ repository, commitCount })),
    (bucket) => bucket.repository,
  ) as { repository: string; commitCount: number } | null;

  return {
    byDay,
    byWeek,
    byMonth,
    mostActiveDay,
    mostActiveRepository,
  };
}

function countBy<T>(
  values: T[],
  keySelector: (value: T) => string,
): Array<[string, number]> {
  const counts = new Map<string, number>();

  for (const value of values) {
    const key = keySelector(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from(counts.entries()).sort(([left], [right]) =>
    left.localeCompare(right),
  );
}

function pickMostActive<T extends { commitCount: number }>(
  buckets: T[],
  keySelector: (value: T) => string,
): T | null {
  if (buckets.length === 0) {
    return null;
  }

  return (
    [...buckets].sort((left, right) => {
      if (right.commitCount !== left.commitCount) {
        return right.commitCount - left.commitCount;
      }

      return keySelector(left).localeCompare(keySelector(right));
    })[0] ?? null
  );
}

function compareObservations(left: CommitObservation, right: CommitObservation): number {
  return (
    left.authoredDateTime.localeCompare(right.authoredDateTime) ||
    left.scanBranch.localeCompare(right.scanBranch) ||
    left.sha.localeCompare(right.sha)
  );
}

function compareCommitRecords(left: CommitRecord, right: CommitRecord): number {
  return (
    left.authoredDateTime.localeCompare(right.authoredDateTime) ||
    left.repository.localeCompare(right.repository) ||
    left.sha.localeCompare(right.sha)
  );
}

function sortFailures(failures: FailureRecord[]): FailureRecord[] {
  return [...failures].sort((left, right) => {
    return (
      left.repository.localeCompare(right.repository) ||
      left.stage.localeCompare(right.stage) ||
      left.message.localeCompare(right.message)
    );
  });
}
