import { buildRunResult } from "./aggregation";
import { GitHubApiError, GitHubClient } from "./github/client";
import { Logger } from "./logger";
import {
  CommandRunner,
  CommitObservation,
  FailureRecord,
  NormalizedConfig,
  RepositoryRecord,
  RunResult,
  SkippedRepository,
  TargetIdentity,
} from "./types";
import { mapLimit } from "./utils/async";
import { groupBy, parseRepositoryShaKey, repositoryShaKey } from "./utils/collections";
import { toErrorMessage } from "./utils/errors";
import { writeFileEnsuringDir } from "./utils/files";
import { matchesBranch } from "./utils/patterns";

export interface AppDependencies {
  client?: GitHubClientLike;
  commandRunner?: CommandRunner;
  logger?: Logger;
  now?: () => number;
  writeJson?: (outputPath: string, result: RunResult) => Promise<void>;
}

export interface GitHubClientLike {
  validateGhInstallation(): Promise<void>;
  validateAuthentication(): Promise<void>;
  getAuthenticatedUser(): Promise<{ login: string; id: string }>;
  resolveTargetIdentity(
    requestedAuthor: string | undefined,
    authenticatedUser: { login: string; id: string },
    emails: string[],
  ): Promise<TargetIdentity>;
  listRepositories(): Promise<RepositoryRecord[]>;
  listBranches(repository: RepositoryRecord): Promise<string[]>;
  listBranchCommits(params: {
    repository: RepositoryRecord;
    branch: string;
    target: TargetIdentity;
  }): Promise<{ observations: CommitObservation[]; missingRef: boolean }>;
  getCommitDiffStats(
    repository: RepositoryRecord,
    sha: string,
  ): Promise<{ additions: number; deletions: number; filesChanged: number }>;
}

export async function runApp(
  config: NormalizedConfig,
  dependencies: AppDependencies = {},
): Promise<RunResult> {
  const logger = dependencies.logger ?? new Logger(config.verbose);
  const client: GitHubClientLike =
    dependencies.client ??
    new GitHubClient(config, logger, dependencies.commandRunner);
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
  logger.info(`Resolved target author ${targetIdentity.login}`);

  logger.info("Discovering repositories");
  const discoveredRepositories = await client.listRepositories();
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
      targetAuthor: targetIdentity.login,
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

  if (config.includeDiffStats && observations.length > 0) {
    logger.info("Enriching diff statistics");
    const diffFailures = await enrichDiffStats(
      observations,
      repositoryMap,
      client,
      config.concurrency,
      logger,
    );
    failures.push(...diffFailures);
  }

  const result = buildRunResult({
    config,
    authenticatedUser: authenticatedUser.login,
    targetAuthor: targetIdentity.login,
    repositoriesDiscovered: discoveredRepositories.length,
    repositoriesIncluded: filtered.passedFilters.length,
    scannedRepositoryCount: filtered.scannable.length,
    observations,
    repositoryMap,
    skippedRepositories: [...filtered.skipped, ...dynamicSkips],
    failures,
    startedAtMs,
    endedAtMs: now(),
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
  skipped: SkippedRepository[];
} {
  const passedFilters: RepositoryRecord[] = [];
  const scannable: RepositoryRecord[] = [];
  const skipped: SkippedRepository[] = [];

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

async function scanRepository(params: {
  client: GitHubClientLike;
  config: NormalizedConfig;
  repository: RepositoryRecord;
  targetIdentity: TargetIdentity;
  logger: Logger;
}): Promise<{
  observations: CommitObservation[];
  failures: FailureRecord[];
  skippedRepositories: SkippedRepository[];
}> {
  const { client, config, repository, targetIdentity, logger } = params;
  const observations: CommitObservation[] = [];
  const failures: FailureRecord[] = [];
  const skippedRepositories: SkippedRepository[] = [];

  logger.info(`Scanning ${repository.fullName}`);

  try {
    const defaultBranchResult = await client.listBranchCommits({
      repository,
      branch: repository.defaultBranch ?? "HEAD",
      target: targetIdentity,
    });

    if (defaultBranchResult.missingRef) {
      skippedRepositories.push({
        repository: repository.fullName,
        reason: "empty_repository",
      });
      return { observations, failures, skippedRepositories };
    }

    observations.push(...defaultBranchResult.observations);
  } catch (error) {
    failures.push(toFailure(error, repository.fullName, "default_branch_scan"));
    return { observations, failures, skippedRepositories };
  }

  if (!config.scanFeatureBranches) {
    return { observations, failures, skippedRepositories };
  }

  let branches: string[] = [];
  try {
    branches = await client.listBranches(repository);
  } catch (error) {
    failures.push(toFailure(error, repository.fullName, "branch_listing"));
    return { observations, failures, skippedRepositories };
  }

  const candidateBranches = branches
    .filter((branch) => branch !== repository.defaultBranch)
    .filter((branch) => matchesBranch(branch, config.branchPatterns));

  for (const branch of candidateBranches) {
    try {
      const result = await client.listBranchCommits({
        repository,
        branch,
        target: targetIdentity,
      });

      observations.push(...result.observations);
    } catch (error) {
      failures.push(toFailure(error, repository.fullName, `feature_branch_scan:${branch}`));
    }
  }

  return { observations, failures, skippedRepositories };
}

async function enrichDiffStats(
  observations: CommitObservation[],
  repositoryMap: Map<string, RepositoryRecord>,
  client: GitHubClientLike,
  concurrency: number,
  logger: Logger,
): Promise<FailureRecord[]> {
  const failures: FailureRecord[] = [];
  const grouped = groupBy(observations, (observation) =>
    repositoryShaKey(observation.repository, observation.sha),
  );

  const entries = Array.from(grouped.entries());
  await mapLimit(entries, concurrency, async ([key, group]) => {
    const { repository: repositoryName, sha } = parseRepositoryShaKey(key);
    const repository = repositoryMap.get(repositoryName);
    if (!repository || !sha) {
      return;
    }

    try {
      const stats = await client.getCommitDiffStats(repository, sha);
      for (const observation of group) {
        observation.additions = stats.additions;
        observation.deletions = stats.deletions;
        observation.filesChanged = stats.filesChanged;
      }
    } catch (error) {
      logger.debug(`Diff-stat enrichment failed for ${repositoryName}@${sha}`);
      failures.push(toFailure(error, repositoryName, "diff_stats"));
    }
  });

  return failures;
}

function toFailure(
  error: unknown,
  repository: string,
  stage: string,
): FailureRecord {
  if (error instanceof GitHubApiError) {
    return error.toFailure(repository, stage);
  }

  return {
    repository,
    stage,
    errorType: "unexpected_error",
    message: toErrorMessage(error),
    retryCount: 0,
  };
}

async function defaultWriteJson(outputPath: string, result: RunResult): Promise<void> {
  await writeFileEnsuringDir(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}
