import {
  AssociatedPullRequest,
  CommitObservation,
  RepositoryRecord,
  TargetIdentity,
} from "../types";

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
  getAssociatedPullRequests?(
    repository: RepositoryRecord,
    sha: string,
  ): Promise<AssociatedPullRequest[]>;
}
