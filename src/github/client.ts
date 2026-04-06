import { spawn } from "node:child_process";
import {
  AuthenticatedUser,
  CommandRunner,
  CommitDiffStats,
  CommitObservation,
  FailureRecord,
  GitHubRunnerResult,
  NormalizedConfig,
  RepositoryRecord,
  TargetIdentity,
} from "../types";
import { Logger } from "../logger";
import { isWithinRange, toUtcIso } from "../utils/dates";

const REST_API_VERSION = "2022-11-28";
const PAGE_SIZE = 100;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

interface GraphqlCommitResponse {
  repository: {
    ref: {
      target: {
        history: {
          nodes: Array<{
            oid: string;
            message: string;
            messageHeadline: string;
            authoredDate: string;
            committedDate: string | null;
            url: string;
            author: {
              email: string | null;
              user: { login: string | null } | null;
            } | null;
          }>;
          pageInfo: {
            hasNextPage: boolean;
            endCursor: string | null;
          };
        };
      } | null;
    } | null;
  } | null;
}

type GraphqlCommitRef = NonNullable<NonNullable<GraphqlCommitResponse["repository"]>["ref"]>;
type GraphqlCommitTarget = NonNullable<GraphqlCommitRef["target"]>;

export class NodeCommandRunner implements CommandRunner {
  public async run(
    command: string,
    args: string[],
    options?: { input?: string },
  ): Promise<GitHubRunnerResult> {
    return await new Promise<GitHubRunnerResult>((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: "pipe",
      });

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      });

      if (options?.input) {
        child.stdin.write(options.input);
      }
      child.stdin.end();
    });
  }
}

export class GitHubApiError extends Error {
  public constructor(
    message: string,
    public readonly errorType: string,
    public readonly statusCode: number | undefined,
    public readonly retryCount: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }

  public toFailure(repository: string, stage: string): FailureRecord {
    return {
      repository,
      stage,
      errorType: this.errorType,
      statusCode: this.statusCode,
      message: this.message,
      retryCount: this.retryCount,
    };
  }
}

export class GitHubClient {
  public constructor(
    private readonly config: NormalizedConfig,
    private readonly logger: Logger,
    private readonly runner: CommandRunner = new NodeCommandRunner(),
  ) {}

  public async validateGhInstallation(): Promise<void> {
    await this.runGh(["--version"], "gh_not_installed");
  }

  public async validateAuthentication(): Promise<void> {
    await this.runGh(["auth", "status"], "authentication_failed");
  }

  public async getAuthenticatedUser(): Promise<AuthenticatedUser> {
    const response = await this.getJson<{ login: string; node_id: string }>(
      ["/user"],
      "authentication_failed",
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

    const response = await this.getJson<{ login: string; node_id: string }>(
      [`/users/${requestedAuthor}`],
      "target_author_not_found",
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

      const batch = await this.getJson<unknown[]>(
        [`/user/repos?${params.toString()}`],
        "repository_discovery_failed",
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
      const batch = await this.getJson<Array<{ name: string }>>(
        [`/repos/${repository.fullName}/branches?${params.toString()}`],
        "branch_listing_failed",
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
      const batch = await this.fetchCommitHistory(params.repository, params.branch, author);
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
    const response = await this.getJson<{
      stats?: { additions?: number; deletions?: number };
      files?: unknown[];
    }>([`/repos/${repository.fullName}/commits/${sha}`], "diff_stats_failed");

    return {
      additions: response.stats?.additions ?? 0,
      deletions: response.stats?.deletions ?? 0,
      filesChanged: response.files?.length ?? 0,
    };
  }

  private async fetchCommitHistory(
    repository: RepositoryRecord,
    branch: string,
    author: { id?: string; emails?: string[] },
  ): Promise<{ observations: CommitObservation[]; missingRef: boolean }> {
    const observations: CommitObservation[] = [];
    let after: string | null = null;
    let missingRef = false;

    while (true) {
      const response: GraphqlCommitResponse = await this.postGraphql<GraphqlCommitResponse>(
        buildCommitHistoryQuery(),
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
          url: node.url,
          sourceMode: branch === repository.defaultBranch ? "default_branch" : "feature_branch",
          authorLogin: node.author?.user?.login ?? null,
          authorEmail: node.author?.email ?? null,
        });
      }

      if (!history.pageInfo.hasNextPage || !history.pageInfo.endCursor) {
        break;
      }

      after = history.pageInfo.endCursor;
    }

    return { observations, missingRef };
  }

  private async getJson<T>(pathArgs: string[], errorType: string): Promise<T> {
    const result = await this.runGh(
      [
        "api",
        "--method",
        "GET",
        "-H",
        "Accept: application/vnd.github+json",
        "-H",
        `X-GitHub-Api-Version: ${REST_API_VERSION}`,
        ...pathArgs,
      ],
      errorType,
    );

    return parseJson<T>(result.stdout, errorType);
  }

  private async postGraphql<T>(
    query: string,
    variables: Record<string, unknown>,
    errorType: string,
  ): Promise<T> {
    const payload = JSON.stringify({ query, variables });
    const result = await this.runGh(
      [
        "api",
        "graphql",
        "--method",
        "POST",
        "--input",
        "-",
        "-H",
        "Accept: application/vnd.github+json",
        "-H",
        `X-GitHub-Api-Version: ${REST_API_VERSION}`,
      ],
      errorType,
      payload,
    );
    const parsed = parseJson<{ data?: T; errors?: Array<{ message: string }> }>(
      result.stdout,
      errorType,
    );

    if (parsed.errors?.length) {
      const firstError = parsed.errors[0];
      throw new GitHubApiError(
        firstError?.message ?? "GitHub GraphQL request failed.",
        errorType,
        undefined,
        0,
      );
    }

    if (!parsed.data) {
      throw new GitHubApiError("GitHub GraphQL response was missing data.", errorType, undefined, 0);
    }

    return parsed.data;
  }

  private async runGh(
    args: string[],
    errorType: string,
    input?: string,
  ): Promise<GitHubRunnerResult> {
    for (let attempt = 0; attempt <= this.config.retryPolicy.maxRetries; attempt += 1) {
      this.logger.debug(`Running gh ${args.join(" ")}`);
      const result = await this.runner.run("gh", args, { input });

      if (result.exitCode === 0) {
        return result;
      }

      const statusCode = parseStatusCode(result.stderr);
      const shouldRetry =
        attempt < this.config.retryPolicy.maxRetries &&
        (statusCode !== undefined
          ? RETRYABLE_STATUS_CODES.has(statusCode)
          : /timed out|timeout|temporary|connection reset/i.test(result.stderr));

      if (!shouldRetry) {
        throw new GitHubApiError(
          cleanErrorMessage(result.stderr),
          errorType,
          statusCode,
          attempt,
        );
      }

      const resetTime = parseRateLimitReset(result.stderr);
      const waitMs =
        resetTime !== undefined
          ? Math.max(resetTime * 1000 - Date.now(), 0)
          : this.config.retryPolicy.backoffMs[attempt] ?? 0;

      this.logger.debug(
        `Retrying gh request after ${waitMs}ms because of ${cleanErrorMessage(result.stderr)}`,
      );
      await sleep(waitMs);
    }

    throw new GitHubApiError("GitHub request failed after retries.", errorType, undefined, this.config.retryPolicy.maxRetries);
  }
}

function buildCommitHistoryQuery(): string {
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
                  url
                  author {
                    email
                    user {
                      login
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

function mapRepository(value: unknown): RepositoryRecord {
  const item = value as {
    full_name: string;
    name: string;
    owner?: { login?: string };
    visibility?: string;
    default_branch?: string | null;
    archived?: boolean;
    fork?: boolean;
    disabled?: boolean;
    private?: boolean;
    html_url?: string;
  };

  return {
    fullName: item.full_name,
    ownerLogin: item.owner?.login ?? item.full_name?.split("/")[0] ?? "",
    name: item.name,
    visibility: item.visibility ?? "unknown",
    defaultBranch: item.default_branch ?? null,
    isArchived: Boolean(item.archived),
    isFork: Boolean(item.fork),
    isDisabled: Boolean(item.disabled),
    isPrivate: Boolean(item.private),
    htmlUrl: item.html_url ?? `https://github.com/${item.full_name}`,
  };
}

function parseJson<T>(value: string, errorType: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new GitHubApiError(
      `Failed to parse JSON for ${errorType}.`,
      errorType,
      undefined,
      0,
    );
  }
}

function parseStatusCode(stderr: string): number | undefined {
  const match = stderr.match(/\b(?:HTTP\s+)?(4\d{2}|5\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function parseRateLimitReset(stderr: string): number | undefined {
  const match = stderr.match(/x-ratelimit-reset:\s*(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function cleanErrorMessage(stderr: string): string {
  return stderr.trim() || "GitHub command failed.";
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
