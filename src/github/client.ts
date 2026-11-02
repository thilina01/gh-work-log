import {
  AssociatedPullRequest,
  AuthenticatedUser,
  CommandRunner,
  CommitDiffStats,
  CommitObservation,
  NormalizedConfig,
  RepositoryRecord,
  TargetIdentity,
} from "../types";
import { Logger } from "../logger";
import { mapGraphqlAssociatedPulls } from "./associated-pulls";
import { isWithinRange, toUtcIso } from "../utils/dates";
import { NodeCommandRunner } from "./command-runner";
import { mapRepository } from "./repository-mapper";
import { GitHubCommandApi } from "./command-api";
import {
  GraphqlCommitRef,
  GraphqlCommitTarget,
  isArray,
  isAssociatedPullResponseArray,
  isAuthenticatedUserResponse,
  isBranchArray,
  isDiffStatsResponse,
  isGraphqlCommitResponse,
} from "./response-schemas";

export { NodeCommandRunner } from "./command-runner";
export { mapRepository } from "./repository-mapper";
export { GitHubApiError } from "./api-error";

const PAGE_SIZE = 100;

export class GitHubClient {
  private readonly api: GitHubCommandApi;

  public constructor(
    private readonly config: NormalizedConfig,
    logger: Logger,
    runner: CommandRunner = new NodeCommandRunner(),
  ) {
    this.api = new GitHubCommandApi(config, logger, runner);
  }

  public async validateGhInstallation(): Promise<void> {
    await this.api.runGh(["--version"], "gh_not_installed");
  }

  public async validateAuthentication(): Promise<void> {
    await this.api.runGh(["auth", "status"], "authentication_failed");
  }

  public async getAuthenticatedUser(): Promise<AuthenticatedUser> {
    const response = await this.api.getJson(
      ["/user"],
      "authentication_failed",
      isAuthenticatedUserResponse,
    );
    return {
      login: response.login,
      id: response.node_id,
    };
  }

  public async resolveTargetIdentity(
    requestedAuthor: string | undefined,
    authenticatedUser: AuthenticatedUser,
    emails: string[],
  ): Promise<TargetIdentity> {
    if (!requestedAuthor || requestedAuthor === authenticatedUser.login) {
      return {
        login: authenticatedUser.login,
        id: authenticatedUser.id,
        emails,
      };
    }

    const response = await this.api.getJson(
      [`/users/${requestedAuthor}`],
      "target_author_not_found",
      isAuthenticatedUserResponse,
    );

    return {
      login: response.login,
      id: response.node_id,
      emails,
    };
  }

  public async listRepositories(): Promise<RepositoryRecord[]> {
    const repositories: RepositoryRecord[] = [];

    for (let page = 1; ; page += 1) {
      const params = new URLSearchParams({
        visibility: "all",
        affiliation: "owner,collaborator,organization_member",
        sort: "full_name",
        direction: "asc",
        per_page: String(PAGE_SIZE),
        page: String(page),
      });

      const batch = await this.api.getJson(
        [`/user/repos?${params.toString()}`],
        "repository_discovery_failed",
        isArray,
      );

      if (!Array.isArray(batch) || batch.length === 0) {
        break;
      }

      repositories.push(...batch.map((item) => mapRepository(item)));
      if (batch.length < PAGE_SIZE) {
        break;
      }
    }

    const deduped = new Map<string, RepositoryRecord>();
    for (const repository of repositories) {
      deduped.set(repository.fullName, repository);
    }

    return Array.from(deduped.values()).sort((left, right) =>
      left.fullName.localeCompare(right.fullName),
    );
  }

  public async listBranches(repository: RepositoryRecord): Promise<string[]> {
    const branches: string[] = [];

    for (let page = 1; ; page += 1) {
      const params = new URLSearchParams({
        per_page: String(PAGE_SIZE),
        page: String(page),
      });
      const batch = await this.api.getJson(
        [`/repos/${repository.fullName}/branches?${params.toString()}`],
        "branch_listing_failed",
        isBranchArray,
      );

      if (!Array.isArray(batch) || batch.length === 0) {
        break;
      }

      branches.push(...batch.map((branch) => branch.name));
      if (batch.length < PAGE_SIZE) {
        break;
      }
    }

    return Array.from(new Set(branches)).sort((left, right) =>
      left.localeCompare(right),
    );
  }

  public async listBranchCommits(params: {
    repository: RepositoryRecord;
    branch: string;
    target: TargetIdentity;
  }): Promise<{ observations: CommitObservation[]; missingRef: boolean }> {
    const observations = new Map<string, CommitObservation>();
    const queries = [
      params.target.id ? { id: params.target.id } : null,
      params.target.emails.length > 0 ? { emails: params.target.emails } : null,
    ].filter(Boolean) as Array<{ id?: string; emails?: string[] }>;

    if (queries.length === 0) {
      queries.push({ id: params.target.id });
    }

    let missingRef = false;

    for (const author of queries) {
      const batch = await this.fetchCommitHistory(
        params.repository,
        params.branch,
        author,
        params.target,
      );
      missingRef = missingRef || batch.missingRef;

      for (const observation of batch.observations) {
        if (!isWithinRange(observation.authoredDateTime, this.config.since, this.config.until)) {
          continue;
        }

        const key = `${observation.repository}:${observation.sha}:${observation.scanBranch}`;
        observations.set(key, observation);
      }
    }

    return {
      observations: Array.from(observations.values()).sort((left, right) =>
        left.authoredDateTime.localeCompare(right.authoredDateTime) ||
        left.repository.localeCompare(right.repository) ||
        left.sha.localeCompare(right.sha) ||
        left.scanBranch.localeCompare(right.scanBranch),
      ),
      missingRef,
    };
  }

  public async getCommitDiffStats(
    repository: RepositoryRecord,
    sha: string,
  ): Promise<CommitDiffStats> {
    const response = await this.api.getJson(
      [`/repos/${repository.fullName}/commits/${sha}`],
      "diff_stats_failed",
      isDiffStatsResponse,
    );

    return {
      additions: response.stats?.additions ?? 0,
      deletions: response.stats?.deletions ?? 0,
      filesChanged: response.files?.length ?? 0,
    };
  }

  public async getAssociatedPullRequests(
    repository: RepositoryRecord,
    sha: string,
  ): Promise<AssociatedPullRequest[]> {
    const response = await this.api.getJson(
      [`/repos/${repository.fullName}/commits/${sha}/pulls`],
      "associated_pulls_failed",
      isAssociatedPullResponseArray,
    );

    return mapGraphqlAssociatedPulls(
      response.map((pull) => ({
        number: pull.number,
        url: pull.html_url,
        title: pull.title,
        state: pull.state,
      })),
    );
  }

  private async fetchCommitHistory(
    repository: RepositoryRecord,
    branch: string,
    author: { id?: string; emails?: string[] },
    target: TargetIdentity,
  ): Promise<{ observations: CommitObservation[]; missingRef: boolean }> {
    const observations: CommitObservation[] = [];
    let after: string | null = null;
    let missingRef = false;

    while (true) {
      const response = await this.api.postGraphql(
        buildCommitHistoryQuery(this.config.includeDiffStats),
        {
          owner: repository.ownerLogin,
          name: repository.name,
          qualifiedName: `refs/heads/${branch}`,
          since: this.config.sinceIso,
          until: this.config.untilIso,
          author,
          after,
        },
        "commit_scan_failed",
        isGraphqlCommitResponse,
      );

      const ref: GraphqlCommitRef | null = response.repository?.ref ?? null;
      if (!ref?.target) {
        missingRef = true;
        break;
      }

      const history: GraphqlCommitTarget["history"] = ref.target.history;
      for (const node of history.nodes) {
        observations.push({
          repository: repository.fullName,
          defaultBranch: repository.defaultBranch ?? branch,
          scanBranch: branch,
          sha: node.oid,
          message: node.message,
          messageHeadline: node.messageHeadline,
          authoredDateTime: toUtcIso(node.authoredDate),
          committedDateTime: node.committedDate ? toUtcIso(node.committedDate) : null,
          ...(node.additions !== undefined &&
          node.deletions !== undefined &&
          node.changedFiles !== undefined
            ? {
                additions: node.additions,
                deletions: node.deletions,
                filesChanged: node.changedFiles,
              }
            : {}),
          url: node.url,
          sourceMode: branch === repository.defaultBranch ? "default_branch" : "feature_branch",
          authorLogin: node.author?.user?.login ?? null,
          authorEmail: node.author?.email ?? null,
          parentCount: node.parents.totalCount,
          mergeIncludesExternalAuthor: detectExternalMergeAuthor(node.parents, target),
          mergeBranchAuthorLogin: resolveMergeBranchAuthorLogin(node.parents),
        });
      }

      if (!history.pageInfo.hasNextPage || !history.pageInfo.endCursor) {
        break;
      }

      after = history.pageInfo.endCursor;
    }

    return { observations, missingRef };
  }

}

function buildCommitHistoryQuery(includeDiffStats: boolean): string {
  return `
    query CommitHistory(
      $owner: String!
      $name: String!
      $qualifiedName: String!
      $since: GitTimestamp
      $until: GitTimestamp
      $author: CommitAuthor
      $after: String
    ) {
      repository(owner: $owner, name: $name) {
        ref(qualifiedName: $qualifiedName) {
          target {
            __typename
            ... on Commit {
              history(
                first: 100
                after: $after
                since: $since
                until: $until
                author: $author
              ) {
                nodes {
                  oid
                  message
                  messageHeadline
                  authoredDate
                  committedDate
                  ${includeDiffStats ? "additions\n                  deletions\n                  changedFiles" : ""}
                  url
                  author {
                    email
                    user {
                      login
                    }
                  }
                  parents(first: 2) {
                    totalCount
                    nodes {
                      author {
                        email
                        user {
                          login
                        }
                      }
                    }
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        }
      }
    }
  `;
}

type MergeParents = {
  totalCount: number;
  nodes: Array<{
    author: { email: string | null; user: { login: string | null } | null } | null;
  }>;
};

export function detectExternalMergeAuthor(parents: MergeParents, target: TargetIdentity): boolean {
  const author = getMergedBranchAuthor(parents);
  if (!author) {
    return false;
  }

  return !isTargetAuthor(author, target);
}

export function resolveMergeBranchAuthorLogin(parents: MergeParents): string | null {
  const author = getMergedBranchAuthor(parents);
  if (!author) {
    return null;
  }

  return author.user?.login ?? author.email ?? null;
}

function getMergedBranchAuthor(
  parents: MergeParents,
): { email: string | null; user: { login: string | null } | null } | null {
  if (parents.totalCount <= 1) {
    return null;
  }

  return parents.nodes[1]?.author ?? null;
}

function isTargetAuthor(
  author: { email: string | null; user: { login: string | null } | null } | null,
  target: TargetIdentity,
): boolean {
  if (!author) {
    return false;
  }

  if (author.user?.login && author.user.login === target.login) {
    return true;
  }

  return Boolean(author.email && target.emails.includes(author.email));
}
