import { RepositoryRecord, TargetIdentity } from "../types";
import { GitHubClientLike } from "../github/client-interface";
import { AsyncSemaphore } from "../utils/async";

export function limitGitHubClient(
  client: GitHubClientLike,
  semaphore: AsyncSemaphore,
): GitHubClientLike {
  const getAssociatedPullRequests =
    client.getAssociatedPullRequests?.bind(client);
  const getProjectBoard = client.getProjectBoard?.bind(client);
  const getIssuesBatch = client.getIssuesBatch?.bind(client);
  const getPullRequestsBatch = client.getPullRequestsBatch?.bind(client);
  const getCommitPullRequestsBatch = client.getCommitPullRequestsBatch?.bind(client);

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
    ...(getProjectBoard
      ? { getProjectBoard: (project) => semaphore.run(() => getProjectBoard(project)) }
      : {}),
    ...(getIssuesBatch
      ? { getIssuesBatch: (keys) => semaphore.run(() => getIssuesBatch(keys)) }
      : {}),
    ...(getPullRequestsBatch
      ? { getPullRequestsBatch: (keys) => semaphore.run(() => getPullRequestsBatch(keys)) }
      : {}),
    ...(getCommitPullRequestsBatch
      ? {
          getCommitPullRequestsBatch: (commits) =>
            semaphore.run(() => getCommitPullRequestsBatch(commits)),
        }
      : {}),
  };
}
