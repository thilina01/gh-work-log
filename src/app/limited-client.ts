import { RepositoryRecord, TargetIdentity } from "../types";
import { GitHubClientLike } from "../github/client-interface";
import { AsyncSemaphore } from "../utils/async";

export function limitGitHubClient(
  client: GitHubClientLike,
  semaphore: AsyncSemaphore,
): GitHubClientLike {
  const getAssociatedPullRequests =
    client.getAssociatedPullRequests?.bind(client);

  return {
    validateGhInstallation: () =>
      semaphore.run(() => client.validateGhInstallation()),
    validateAuthentication: () =>
      semaphore.run(() => client.validateAuthentication()),
    getAuthenticatedUser: () =>
      semaphore.run(() => client.getAuthenticatedUser()),
    resolveTargetIdentity: (requestedAuthor, authenticatedUser, emails) =>
      semaphore.run(() =>
        client.resolveTargetIdentity(requestedAuthor, authenticatedUser, emails),
      ),
    listRepositories: () => semaphore.run(() => client.listRepositories()),
    listBranches: (repository: RepositoryRecord) =>
      semaphore.run(() => client.listBranches(repository)),
    listBranchCommits: (params: {
      repository: RepositoryRecord;
      branch: string;
      target: TargetIdentity;
    }) => semaphore.run(() => client.listBranchCommits(params)),
    getCommitDiffStats: (repository, sha) =>
      semaphore.run(() => client.getCommitDiffStats(repository, sha)),
    ...(getAssociatedPullRequests
      ? {
          getAssociatedPullRequests: (repository: RepositoryRecord, sha: string) =>
            semaphore.run(() =>
              getAssociatedPullRequests(repository, sha),
            ),
        }
      : {}),
  };
}
