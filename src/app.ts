import { buildCommitRecords, buildRunResult } from "./aggregation";
import { enrichAssociatedPullRequests } from "./github/associated-pulls";
import { GitHubClient } from "./github/client";
import { GitHubClientLike } from "./github/client-interface";
import { scanRepository } from "./app/scan-repository";
import { toFailure } from "./app/failure";
import { limitGitHubClient } from "./app/limited-client";
import { Logger } from "./logger";
import {
  AssociatedPullRequest,
  CommandRunner,
  CommitRecord,
  FailureRecord,
  NormalizedConfig,
  RepositoryRecord,
  RunResult,
  SkipRecord,
} from "./types";
import { createSemaphore, mapLimit } from "./utils/async";
import { repositoryShaKey } from "./utils/collections";
import { toErrorMessage } from "./utils/errors";
import { writeFileEnsuringDir } from "./utils/files";
import { enrichWorkTracking } from "./work-tracking/enrich";
import { GhBoard, WorkTrackingClient, WorkTrackingReport } from "./work-tracking/types";

export type { GitHubClientLike } from "./github/client-interface";

export interface AppDependencies {
  client?: GitHubClientLike;
  commandRunner?: CommandRunner;
  logger?: Logger;
  now?: () => number;
  writeJson?: (outputPath: string, result: RunResult) => Promise<void>;
}

export async function runApp(
  config: NormalizedConfig,
  dependencies: AppDependencies = {},
): Promise<RunResult> {
  const logger = dependencies.logger ?? new Logger(config.verbose);
  const rawClient: GitHubClientLike =
    dependencies.client ??
    new GitHubClient(config, logger, dependencies.commandRunner);
  const client = limitGitHubClient(rawClient, createSemaphore(config.concurrency));
  const now = dependencies.now ?? (() => Date.now());
  const writeJson = dependencies.writeJson ?? defaultWriteJson;
  const startedAtMs = now();

  logger.info("Validating GitHub CLI availability");
  await client.validateGhInstallation();
  logger.info("Validating GitHub authentication");
  await client.validateAuthentication();

  const authenticatedUser = await client.getAuthenticatedUser();
  logger.info(`Authenticated as ${authenticatedUser.login}`);

  const targetIdentity = await client.resolveTargetIdentity(
    config.requestedAuthor,
    authenticatedUser,
    config.emails,
  );
  if (config.organizationReport) {
    logger.info(`Collecting commits for all authors in ${config.includeOrgs.join(", ")}`);
  } else {
    logger.info(`Resolved target author ${targetIdentity.login}`);
  }

  const workTrackingClient =
    config.enrichTasks && !config.dryRun ? requireWorkTrackingClient(client) : null;
  if (workTrackingClient && config.workTracking) {
    logger.info(
      `Discovering repositories and loading project board ${config.workTracking.project.owner}/${config.workTracking.project.number}`,
    );
  } else {
    logger.info("Discovering repositories");
  }
  const [discoveredRepositories, board] = await Promise.all([
    client.listRepositories(),
    workTrackingClient ? loadBoard(workTrackingClient, config) : Promise.resolve(null),
  ]);
  const boardSnapshotAt = board ? new Date(now()).toISOString() : null;
  if (board) {
    logger.info(`Loaded ${board.items.length} issues from project board "${board.title}"`);
  }
  const filtered = filterRepositories(
    discoveredRepositories,
    authenticatedUser.login,
    config,
  );
  logger.info(
    `Repository discovery complete: ${discoveredRepositories.length} discovered, ${filtered.passedFilters.length} included, ${filtered.skipped.length} skipped`,
  );

  const repositoryMap = new Map(
    discoveredRepositories.map((repository) => [repository.fullName, repository]),
  );

  if (config.dryRun) {
    const result = buildRunResult({
      config,
      authenticatedUser: authenticatedUser.login,
      targetAuthor: config.organizationReport
        ? "All contributors"
        : targetIdentity.login,
      repositoriesDiscovered: discoveredRepositories.length,
      repositoriesIncluded: filtered.passedFilters.length,
      scannedRepositoryCount: 0,
      observations: [],
      repositoryMap,
      skippedRepositories: filtered.skipped,
      failures: [],
      startedAtMs,
      endedAtMs: now(),
    });
    await writeJson(config.outputPath, result);
    return result;
  }

  const scanResults = await mapLimit(
    filtered.scannable,
    config.concurrency,
    async (repository) =>
      scanRepository({
        client,
        config,
        repository,
        targetIdentity,
        logger,
      }),
  );

  const observations = scanResults.flatMap((result) => result.observations);
  const failures = scanResults.flatMap((result) => result.failures);
  const dynamicSkips = scanResults.flatMap((result) => result.skippedRepositories);

  if (config.enrichPrs && observations.length > 0) {
    logger.info("Enriching associated pull requests");
  }
  const commits = buildCommitRecords(observations, repositoryMap, config);
  const commitsNeedingDiffStats = commits.filter(
    (commit) =>
      commit.additions === undefined ||
      commit.deletions === undefined ||
      commit.filesChanged === undefined,
  );
  if (config.includeDiffStats && commitsNeedingDiffStats.length > 0) {
    logger.info(
      `Fetching diff statistics for ${commitsNeedingDiffStats.length} commits`,
    );
  }
  const pullEnrichment =
    config.enrichPrs && commits.length > 0
      ? enrichAssociatedPullRequests({
        commits,
        repositoryMap,
        client: {
          getAssociatedPullRequests:
            client.getAssociatedPullRequests?.bind(client) ??
            (async () => [] as AssociatedPullRequest[]),
        },
        concurrency: config.concurrency,
        onError: (repository, sha, error) => {
          logger.info(
            `Associated PR lookup failed for ${repository}@${sha}: ${toErrorMessage(error)}`,
          );
        },
      })
      : Promise.resolve(undefined);
  const diffEnrichment =
    config.includeDiffStats && commitsNeedingDiffStats.length > 0
      ? enrichDiffStats(
          commitsNeedingDiffStats,
          repositoryMap,
          client,
          config.concurrency,
          logger,
        )
      : Promise.resolve([]);
  const [diffFailures, enrichedCommits] = await Promise.all([
    diffEnrichment,
    pullEnrichment,
  ]);
  failures.push(...diffFailures);

  if (enrichedCommits) {
    const commitsByKey = new Map(
      commits.map((commit) => [
        repositoryShaKey(commit.repository, commit.sha),
        commit,
      ]),
    );
    for (const enrichedCommit of enrichedCommits) {
      if (!enrichedCommit.associatedPullRequests) {
        continue;
      }
      const commit = commitsByKey.get(
        repositoryShaKey(enrichedCommit.repository, enrichedCommit.sha),
      );
      if (commit) {
        commit.associatedPullRequests = enrichedCommit.associatedPullRequests;
      }
    }
  }

  let workTracking: WorkTrackingReport | undefined;
  if (board && workTrackingClient && config.workTracking && boardSnapshotAt) {
    const enrichment = await enrichWorkTracking({
      commits,
      board,
      settings: config.workTracking,
      taskDetail: config.taskDetail,
      includeDiffStats: config.includeDiffStats,
      client: workTrackingClient,
      concurrency: config.concurrency,
      snapshotAt: boardSnapshotAt,
      logger,
    });
    failures.push(...enrichment.failures);
    workTracking = enrichment.report;
  }

  const result = buildRunResult({
    config,
    authenticatedUser: authenticatedUser.login,
    targetAuthor: config.organizationReport
      ? "All contributors"
      : targetIdentity.login,
    repositoriesDiscovered: discoveredRepositories.length,
    repositoriesIncluded: filtered.passedFilters.length,
    scannedRepositoryCount: filtered.scannable.length,
    ...(workTracking ? { workTracking } : {}),
    observations,
    repositoryMap,
    skippedRepositories: [...filtered.skipped, ...dynamicSkips],
    failures,
    startedAtMs,
    endedAtMs: now(),
    commits,
  });

  await writeJson(config.outputPath, result);
  logger.info(
    `Finished: ${result.statistics.summary.uniqueCommits} unique commits across ${result.statistics.summary.repositoriesWithCommits} repositories`,
  );
  return result;
}

export function filterRepositories(
  repositories: RepositoryRecord[],
  authenticatedLogin: string,
  config: NormalizedConfig,
): {
  // Repositories that passed org/repo include-exclude and owned-only
  // filtering. This is NOT "repositories we proceeded to scan" -- the
  // disabled/missing-default-branch checks below can still move one of
  // these into `skipped`. Kept as the source for `discovery.repositoriesIncluded`
  // in the JSON/HTML output; that external field name is unchanged.
  passedFilters: RepositoryRecord[];
  scannable: RepositoryRecord[];
  skipped: SkipRecord[];
} {
  const passedFilters: RepositoryRecord[] = [];
  const scannable: RepositoryRecord[] = [];
  const skipped: SkipRecord[] = [];

  for (const repository of repositories) {
    const includeReasons: string[] = [];
    if (
      config.includeOrgs.length > 0 &&
      !config.includeOrgs.includes(repository.ownerLogin)
    ) {
      includeReasons.push("not_in_included_orgs");
    }
    if (
      config.includeRepos.length > 0 &&
      !config.includeRepos.includes(repository.fullName)
    ) {
      includeReasons.push("not_in_included_repositories");
    }

    if (includeReasons.length > 0) {
      skipped.push({
        repository: repository.fullName,
        reason: includeReasons[0] ?? "not_included",
      });
      continue;
    }

    if (config.excludeOrgs.includes(repository.ownerLogin)) {
      skipped.push({
        repository: repository.fullName,
        reason: "excluded_org",
      });
      continue;
    }

    if (config.excludeRepos.includes(repository.fullName)) {
      skipped.push({
        repository: repository.fullName,
        reason: "excluded_repository",
      });
      continue;
    }

    if (config.ownedOnly && repository.ownerLogin !== authenticatedLogin) {
      skipped.push({
        repository: repository.fullName,
        reason: "owned_only_mismatch",
      });
      continue;
    }

    passedFilters.push(repository);

    if (repository.isDisabled) {
      skipped.push({
        repository: repository.fullName,
        reason: "disabled_repository",
      });
      continue;
    }

    if (!repository.defaultBranch) {
      skipped.push({
        repository: repository.fullName,
        reason: "missing_default_branch",
      });
      continue;
    }

    scannable.push(repository);
  }

  return { passedFilters, scannable, skipped };
}

async function enrichDiffStats(
  commits: CommitRecord[],
  repositoryMap: Map<string, RepositoryRecord>,
  client: GitHubClientLike,
  concurrency: number,
  logger: Logger,
): Promise<FailureRecord[]> {
  const failures: FailureRecord[] = [];

  await mapLimit(commits, concurrency, async (commit) => {
    const repository = repositoryMap.get(commit.repository);
    if (!repository) {
      return;
    }

    try {
      const stats = await client.getCommitDiffStats(repository, commit.sha);
      commit.additions = stats.additions;
      commit.deletions = stats.deletions;
      commit.filesChanged = stats.filesChanged;
    } catch (error) {
      logger.debug(`Diff-stat enrichment failed for ${commit.repository}@${commit.sha}`);
      failures.push(toFailure(error, commit.repository, "diff_stats"));
    }
  });

  return failures;
}

function requireWorkTrackingClient(client: GitHubClientLike): WorkTrackingClient {
  const { getProjectBoard, getIssuesBatch, getPullRequestsBatch, getCommitPullRequestsBatch } = client;
  if (!getProjectBoard || !getIssuesBatch || !getPullRequestsBatch || !getCommitPullRequestsBatch) {
    throw new Error("`--enrich-tasks` is not supported by this GitHub client.");
  }
  return {
    getProjectBoard: getProjectBoard.bind(client),
    getIssuesBatch: getIssuesBatch.bind(client),
    getPullRequestsBatch: getPullRequestsBatch.bind(client),
    getCommitPullRequestsBatch: getCommitPullRequestsBatch.bind(client),
  };
}

async function loadBoard(
  client: WorkTrackingClient,
  config: NormalizedConfig,
): Promise<GhBoard | null> {
  const settings = config.workTracking;
  if (!settings) {
    return null;
  }
  try {
    return await client.getProjectBoard(settings.project);
  } catch (error) {
    throw new Error(
      `Work tracking: could not read project ${settings.project.owner}/${settings.project.number}: ${toErrorMessage(error)}. ` +
        'Reading GitHub Projects needs the gh "project" scope: gh auth refresh -h github.com -s project',
    );
  }
}

async function defaultWriteJson(outputPath: string, result: RunResult): Promise<void> {
  await writeFileEnsuringDir(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}
