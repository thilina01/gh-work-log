import {
  CommitObservation,
  FailureRecord,
  NormalizedConfig,
  RepositoryRecord,
  SkipRecord,
  TargetIdentity,
} from "../types";
import { Logger } from "../logger";
import { GitHubClientLike } from "../github/client-interface";
import { matchesBranch } from "../utils/patterns";
import { mapLimit } from "../utils/async";
import { toFailure } from "./failure";

export async function scanRepository(params: {
  client: GitHubClientLike;
  config: NormalizedConfig;
  repository: RepositoryRecord;
  targetIdentity: TargetIdentity;
  logger: Logger;
}): Promise<{
  observations: CommitObservation[];
  failures: FailureRecord[];
  skippedRepositories: SkipRecord[];
}> {
  const { client, config, repository, targetIdentity, logger } = params;
  const observations: CommitObservation[] = [];
  const failures: FailureRecord[] = [];
  const skippedRepositories: SkipRecord[] = [];

  logger.info(`Scanning ${repository.fullName}`);

  const branchListing = config.scanFeatureBranches
    ? Promise.resolve()
        .then(() => client.listBranches(repository))
        .then(
          (branches) => ({ branches }),
          (error: unknown) => ({ error }),
        )
    : Promise.resolve(undefined);

  try {
    const defaultBranchResult = await client.listBranchCommits({
      repository,
      branch: repository.defaultBranch ?? "HEAD",
      target: targetIdentity,
    });
    if (defaultBranchResult.missingRef) {
      await branchListing;
      skippedRepositories.push({
        repository: repository.fullName,
        reason: "empty_repository",
      });
      return { observations, failures, skippedRepositories };
    }

    observations.push(...defaultBranchResult.observations);
  } catch (error) {
    await branchListing;
    failures.push(toFailure(error, repository.fullName, "default_branch_scan"));
    return { observations, failures, skippedRepositories };
  }

  if (!config.scanFeatureBranches) {
    return { observations, failures, skippedRepositories };
  }

  const branchResult = await branchListing;
  if (!branchResult) {
    throw new Error("Branch discovery was not started for an enabled branch scan.");
  }
  if ("error" in branchResult) {
    failures.push(
      toFailure(branchResult.error, repository.fullName, "branch_listing"),
    );
    return { observations, failures, skippedRepositories };
  }

  const candidateBranches = branchResult.branches
    .filter((branch) => branch !== repository.defaultBranch)
    .filter((branch) => matchesBranch(branch, config.branchPatterns));

  const branchResults = await mapLimit(candidateBranches, config.concurrency, async (branch) => {
    try {
      const result = await client.listBranchCommits({
        repository,
        branch,
        target: targetIdentity,
      });
      return { observations: result.observations };
    } catch (error) {
      return {
        observations: [],
        failure: toFailure(error, repository.fullName, `feature_branch_scan:${branch}`),
      };
    }
  });
  for (const result of branchResults) {
    observations.push(...result.observations);
    if (result.failure) {
      failures.push(result.failure);
    }
  }

  return { observations, failures, skippedRepositories };
}
