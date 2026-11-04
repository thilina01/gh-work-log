import { describe, expect, it } from "vitest";
import {
  GitHubApiError,
  GitHubClient,
  detectExternalMergeAuthor,
  mapRepository,
  resolveMergeBranchAuthorLogin,
} from "../../src/github/client";
import { CommandRunner, NormalizedConfig, TargetIdentity } from "../../src/types";
import { Logger } from "../../src/logger";

const target: TargetIdentity = {
  login: "alice",
  id: "U_1",
  emails: ["alice@example.com"],
};

function makeConfig(): NormalizedConfig {
  return {
    since: new Date("2026-03-01T00:00:00.000Z"),
    until: new Date("2026-04-01T00:00:00.000Z"),
    sinceIso: "2026-03-01T00:00:00.000Z",
    untilIso: "2026-04-01T00:00:00.000Z",
    outputPath: "/tmp/report.json",
    emails: [],
    includeOrgs: [],
    excludeOrgs: [],
    includeRepos: [],
    excludeRepos: [],
    branchPatterns: [],
    ownedOnly: false,
    organizationReport: false,
    scanFeatureBranches: false,
    includeDiffStats: false,
    detectWip: false,
    classifyMessages: false,
    enrichPrs: false,
    enrichTasks: false,
    taskDetail: "full",
    workTracking: null,
    ignoreLocalConfig: false,
    verbose: false,
    dryRun: false,
    profile: "operator",
    concurrency: 5,
    retryPolicy: { maxRetries: 0, backoffMs: [] },
  };
}

function responseRunner(stdout: string): CommandRunner {
  return {
    async run() {
      return { stdout, stderr: "", exitCode: 0 };
    },
  };
}

function sequenceRunner(
  results: Array<{ stdout: string; stderr?: string; exitCode?: number }>,
): { runner: CommandRunner; calls: () => number } {
  let callCount = 0;
  return {
    runner: {
      async run() {
        const result = results[callCount++];
        if (!result) {
          throw new Error("Unexpected command invocation.");
        }
        return {
          stdout: result.stdout,
          stderr: result.stderr ?? "",
          exitCode: result.exitCode ?? 0,
        };
      },
    },
    calls: () => callCount,
  };
}

describe("GitHub API response validation", () => {
  it("maps validated REST responses", async () => {
    const user = new GitHubClient(
      makeConfig(),
      new Logger(false),
      responseRunner(JSON.stringify({ login: "alice", node_id: "U_1" })),
    );
    await expect(user.getAuthenticatedUser()).resolves.toEqual({
      login: "alice",
      id: "U_1",
    });

    const repository = new GitHubClient(
      makeConfig(),
      new Logger(false),
      responseRunner(
        JSON.stringify([
          {
            full_name: "org/service",
            name: "service",
            owner: { login: "org" },
            default_branch: "main",
            visibility: "private",
          },
        ]),
      ),
    );
    await expect(repository.listRepositories()).resolves.toMatchObject([
      { fullName: "org/service", defaultBranch: "main" },
    ]);

    const diffStats = new GitHubClient(
      makeConfig(),
      new Logger(false),
      responseRunner(JSON.stringify({ stats: { additions: 2, deletions: 1 }, files: [{}, {}] })),
    );
    await expect(
      diffStats.getCommitDiffStats(
        {
          fullName: "org/service",
          ownerLogin: "org",
          name: "service",
          visibility: "private",
          defaultBranch: "main",
          isArchived: false,
          isFork: false,
          isDisabled: false,
          isPrivate: true,
          htmlUrl: "https://github.com/org/service",
        },
        "abc",
      ),
    ).resolves.toEqual({ additions: 2, deletions: 1, filesChanged: 2 });

    const pulls = new GitHubClient(
      makeConfig(),
      new Logger(false),
      responseRunner(
        JSON.stringify([
          {
            number: 42,
            html_url: "https://github.com/org/service/pull/42",
            title: "Add validated mapping",
            state: "closed",
          },
        ]),
      ),
    );
    await expect(
      pulls.getAssociatedPullRequests(
        {
          fullName: "org/service",
          ownerLogin: "org",
          name: "service",
          visibility: "private",
          defaultBranch: "main",
          isArchived: false,
          isFork: false,
          isDisabled: false,
          isPrivate: true,
          htmlUrl: "https://github.com/org/service",
        },
        "abc",
      ),
    ).resolves.toEqual([
      {
        number: 42,
        url: "https://github.com/org/service/pull/42",
        title: "Add validated mapping",
        state: "closed",
      },
    ]);
  });

  it("maps a validated GraphQL commit history", async () => {
    let graphqlInput = "";
    const client = new GitHubClient(
      { ...makeConfig(), includeDiffStats: true },
      new Logger(false),
      {
        async run(_command, _args, options) {
          graphqlInput = options?.input ?? "";
          return {
            stdout: JSON.stringify({
              data: {
                repository: {
                  ref: {
                    target: {
                      history: {
                        nodes: [
                          {
                            oid: "abc",
                            message: "feat: validated",
                            messageHeadline: "feat: validated",
                            authoredDate: "2026-03-02T10:00:00Z",
                            committedDate: null,
                            additions: 2,
                            deletions: 1,
                            changedFiles: 3,
                            url: "https://github.com/org/service/commit/abc",
                            author: { email: "alice@example.com", user: { login: "alice" } },
                            parents: { totalCount: 1, nodes: [{ author: null }] },
                          },
                        ],
                        pageInfo: { hasNextPage: false, endCursor: null },
                      },
                    },
                  },
                },
              },
            }),
            stderr: "",
            exitCode: 0,
          };
        },
      },
    );

    const result = await client.listBranchCommits({
      repository: {
        fullName: "org/service",
        ownerLogin: "org",
        name: "service",
        visibility: "private",
        defaultBranch: "main",
        isArchived: false,
        isFork: false,
        isDisabled: false,
        isPrivate: true,
        htmlUrl: "https://github.com/org/service",
      },
      branch: "main",
      target,
    });

    expect(result.observations).toMatchObject([
      {
        sha: "abc",
        message: "feat: validated",
        authorLogin: "alice",
        additions: 2,
        deletions: 1,
        filesChanged: 3,
      },
    ]);
    expect(graphqlInput).toContain("additions");
    expect(graphqlInput).toContain("deletions");
    expect(graphqlInput).toContain("changedFiles");
    const request = JSON.parse(graphqlInput) as { query: string };
    expect(request.query).not.toMatch(/author\s*\{\s*name/);
    expect(result.observations[0]).not.toHaveProperty("authorName");
  });

  it("scans every author once and omits emails in organization mode", async () => {
    let graphqlInput = "";
    const client = new GitHubClient(
      { ...makeConfig(), organizationReport: true },
      new Logger(false),
      {
        async run(_command, _args, options) {
          graphqlInput = options?.input ?? "";
          return {
            stdout: JSON.stringify({
              data: {
                repository: {
                  ref: {
                    target: {
                      history: {
                        nodes: [
                          {
                            oid: "abc",
                            message: "feat: all authors",
                            messageHeadline: "feat: all authors",
                            authoredDate: "2026-03-02T10:00:00Z",
                            committedDate: null,
                            url: "https://github.com/org/service/commit/abc",
                            author: {
                              name: "release-bot[bot]",
                              user: { login: "bob" },
                            },
                            parents: { totalCount: 1, nodes: [{ author: null }] },
                          },
                        ],
                        pageInfo: { hasNextPage: false, endCursor: null },
                      },
                    },
                  },
                },
              },
            }),
            stderr: "",
            exitCode: 0,
          };
        },
      },
    );

    const result = await client.listBranchCommits({
      repository: {
        fullName: "org/service",
        ownerLogin: "org",
        name: "service",
        visibility: "private",
        defaultBranch: "main",
        isArchived: false,
        isFork: false,
        isDisabled: false,
        isPrivate: true,
        htmlUrl: "https://github.com/org/service",
      },
      branch: "main",
      target,
    });

    const request = JSON.parse(graphqlInput) as {
      query: string;
      variables: { author: unknown };
    };
    expect(request.variables.author).toBeNull();
    expect(request.query).not.toMatch(/\bemail\b/);
    expect(request.query).toMatch(/author\s*\{\s*name\s+user\s*\{/);
    expect(result.observations).toMatchObject([
      {
        sha: "abc",
        authorLogin: "bob",
        authorName: "release-bot[bot]",
        authorEmail: null,
      },
    ]);
  });

  it("omits an absent HTTP status from failure records", () => {
    expect(new GitHubApiError("Failure", "test", undefined, 0).toFailure("org/service", "scan"))
      .not.toHaveProperty("statusCode");
  });

  it("rejects malformed branch-list payloads", async () => {
    const client = new GitHubClient(makeConfig(), new Logger(false), responseRunner('[{"name":7}]'));

    await expect(
      client.listBranches({
        fullName: "org/service",
        ownerLogin: "org",
        name: "service",
        visibility: "private",
        defaultBranch: "main",
        isArchived: false,
        isFork: false,
        isDisabled: false,
        isPrivate: true,
        htmlUrl: "https://github.com/org/service",
      }),
    ).rejects.toThrow("GitHub returned an invalid response for branch_listing_failed.");
  });

  it("follows repository branch pagination", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      name: `branch-${String(index).padStart(3, "0")}`,
    }));
    const responses = sequenceRunner([
      { stdout: JSON.stringify(firstPage) },
      { stdout: JSON.stringify([{ name: "branch-100" }]) },
    ]);
    const client = new GitHubClient(makeConfig(), new Logger(false), responses.runner);

    const branches = await client.listBranches({
      fullName: "org/service",
      ownerLogin: "org",
      name: "service",
      visibility: "private",
      defaultBranch: "main",
      isArchived: false,
      isFork: false,
      isDisabled: false,
      isPrivate: true,
      htmlUrl: "https://github.com/org/service",
    });

    expect(branches).toHaveLength(101);
    expect(responses.calls()).toBe(2);
  });

  it("retries retryable GitHub responses before returning validated data", async () => {
    const responses = sequenceRunner([
      { stdout: "", stderr: "HTTP 503 Service Unavailable", exitCode: 1 },
      { stdout: "[]" },
    ]);
    const client = new GitHubClient(
      { ...makeConfig(), retryPolicy: { maxRetries: 1, backoffMs: [0] } },
      new Logger(false),
      responses.runner,
    );

    await expect(
      client.listBranches({
        fullName: "org/service",
        ownerLogin: "org",
        name: "service",
        visibility: "private",
        defaultBranch: "main",
        isArchived: false,
        isFork: false,
        isDisabled: false,
        isPrivate: true,
        htmlUrl: "https://github.com/org/service",
      }),
    ).resolves.toEqual([]);
    expect(responses.calls()).toBe(2);
  });

  it("rejects malformed GraphQL commit-history nodes", async () => {
    const client = new GitHubClient(
      makeConfig(),
      new Logger(false),
      responseRunner(
        JSON.stringify({
          data: {
            repository: {
              ref: {
                target: {
                  history: {
                    nodes: [{}],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              },
            },
          },
        }),
      ),
    );

    await expect(
      client.listBranchCommits({
        repository: {
          fullName: "org/service",
          ownerLogin: "org",
          name: "service",
          visibility: "private",
          defaultBranch: "main",
          isArchived: false,
          isFork: false,
          isDisabled: false,
          isPrivate: true,
          htmlUrl: "https://github.com/org/service",
        },
        branch: "main",
        target,
      }),
    ).rejects.toThrow("GitHub returned an invalid response for commit_scan_failed.");
  });
});

describe("detectExternalMergeAuthor", () => {
  it("returns false for non-merge commits", () => {
    expect(
      detectExternalMergeAuthor(
        { totalCount: 1, nodes: [{ author: { email: "bob@example.com", user: { login: "bob" } } }] },
        target,
      ),
    ).toBe(false);
  });

  it("returns false when the merged branch tip was authored by the target login", () => {
    expect(
      detectExternalMergeAuthor(
        {
          totalCount: 2,
          nodes: [
            { author: { email: "someone@example.com", user: { login: "someone" } } },
            { author: { email: "alice@example.com", user: { login: "alice" } } },
          ],
        },
        target,
      ),
    ).toBe(false);
  });

  it("returns false when the merged branch tip matches a configured target email", () => {
    expect(
      detectExternalMergeAuthor(
        {
          totalCount: 2,
          nodes: [
            { author: null },
            { author: { email: "alice@example.com", user: { login: null } } },
          ],
        },
        target,
      ),
    ).toBe(false);
  });

  it("returns true when the merged branch tip was authored by someone else", () => {
    expect(
      detectExternalMergeAuthor(
        {
          totalCount: 2,
          nodes: [
            { author: { email: "alice@example.com", user: { login: "alice" } } },
            { author: { email: "bob@example.com", user: { login: "bob" } } },
          ],
        },
        target,
      ),
    ).toBe(true);
  });

  it("returns false when the second parent's author is missing entirely", () => {
    expect(
      detectExternalMergeAuthor(
        { totalCount: 2, nodes: [{ author: { email: "alice@example.com", user: { login: "alice" } } }] },
        target,
      ),
    ).toBe(false);
  });
});

describe("resolveMergeBranchAuthorLogin", () => {
  it("returns null for non-merge commits", () => {
    expect(
      resolveMergeBranchAuthorLogin({
        totalCount: 1,
        nodes: [{ author: { email: "bob@example.com", user: { login: "bob" } } }],
      }),
    ).toBeNull();
  });

  it("prefers the merged branch tip's login over its email", () => {
    expect(
      resolveMergeBranchAuthorLogin({
        totalCount: 2,
        nodes: [
          { author: { email: "alice@example.com", user: { login: "alice" } } },
          { author: { email: "bob@example.com", user: { login: "bob" } } },
        ],
      }),
    ).toBe("bob");
  });

  it("falls back to email when the merged branch tip has no public login", () => {
    expect(
      resolveMergeBranchAuthorLogin({
        totalCount: 2,
        nodes: [
          { author: { email: "alice@example.com", user: { login: "alice" } } },
          { author: { email: "bob@example.com", user: null } },
        ],
      }),
    ).toBe("bob@example.com");
  });

  it("returns null when the second parent's author is missing entirely", () => {
    expect(
      resolveMergeBranchAuthorLogin({
        totalCount: 2,
        nodes: [{ author: { email: "alice@example.com", user: { login: "alice" } } }],
      }),
    ).toBeNull();
  });
});

describe("mapRepository", () => {
  it("maps a well-formed payload", () => {
    expect(
      mapRepository({
        full_name: "org/service",
        name: "service",
        owner: { login: "org" },
        visibility: "private",
        default_branch: "main",
        archived: false,
        fork: false,
        disabled: false,
        private: true,
        html_url: "https://github.com/org/service",
      }),
    ).toEqual({
      fullName: "org/service",
      ownerLogin: "org",
      name: "service",
      visibility: "private",
      defaultBranch: "main",
      isArchived: false,
      isFork: false,
      isDisabled: false,
      isPrivate: true,
      htmlUrl: "https://github.com/org/service",
    });
  });

  it("throws when full_name is missing", () => {
    expect(() => mapRepository({ name: "service" })).toThrow(
      'Expected "full_name" in repository payload to be a string.',
    );
  });

  it("throws when a field has the wrong type", () => {
    expect(() =>
      mapRepository({ full_name: "org/service", name: "service", archived: "yes" }),
    ).toThrow('Expected "archived" in repository payload to be a boolean.');
  });

  it("falls back to defaults for missing optional fields", () => {
    expect(mapRepository({ full_name: "org/service", name: "service" })).toEqual({
      fullName: "org/service",
      ownerLogin: "org",
      name: "service",
      visibility: "unknown",
      defaultBranch: null,
      isArchived: false,
      isFork: false,
      isDisabled: false,
      isPrivate: false,
      htmlUrl: "https://github.com/org/service",
    });
  });
});
