import { describe, expect, it, vi } from "vitest";
import {
  enrichAssociatedPullRequests,
  mapGraphqlAssociatedPulls,
} from "../../src/github/associated-pulls";
import { CommitRecord, RepositoryRecord } from "../../src/types";

function makeCommit(overrides: Partial<CommitRecord> = {}): CommitRecord {
  return {
    repository: "org/service",
    branch: "main",
    scanBranch: "main",
    sha: "abc123",
    message: "feat: something",
    authoredDateTime: "2026-03-02T10:00:00.000Z",
    committedDateTime: "2026-03-02T10:01:00.000Z",
    url: "https://github.com/org/service/commit/abc123",
    sourceMode: "default_branch",
    authorLogin: "alice",
    authorEmail: "alice@example.com",
    isWip: false,
    isMergeCommit: false,
    mergeIncludesExternalAuthor: false,
    mergeBranchAuthorLogin: null,
    ...overrides,
  };
}

function makeRepository(): RepositoryRecord {
  return {
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
  };
}

describe("associated pull mapping", () => {
  it("maps valid nodes and ignores malformed ones", () => {
    expect(
      mapGraphqlAssociatedPulls([
        {
          number: 12,
          url: "https://github.com/org/service/pull/12",
          title: "Add feature",
          state: "MERGED",
        },
        { number: "bad" },
        null,
      ]),
    ).toEqual([
      {
        number: 12,
        url: "https://github.com/org/service/pull/12",
        title: "Add feature",
        state: "MERGED",
      },
    ]);
  });
});

describe("enrichAssociatedPullRequests", () => {
  it("attaches pulls when present and leaves commits alone when absent", async () => {
    const repository = makeRepository();
    const enriched = await enrichAssociatedPullRequests({
      commits: [
        makeCommit({ sha: "with-pr" }),
        makeCommit({ sha: "without-pr" }),
      ],
      repositoryMap: new Map([[repository.fullName, repository]]),
      concurrency: 2,
      client: {
        getAssociatedPullRequests: async (_repo, sha) => {
          if (sha === "with-pr") {
            return [
              {
                number: 9,
                url: "https://github.com/org/service/pull/9",
                title: "Ship it",
                state: "MERGED",
              },
            ];
          }
          return [];
        },
      },
    });

    expect(enriched[0]?.associatedPullRequests).toEqual([
      {
        number: 9,
        url: "https://github.com/org/service/pull/9",
        title: "Ship it",
        state: "MERGED",
      },
    ]);
    expect(enriched[1]?.associatedPullRequests).toBeUndefined();
  });

  it("soft-fails enrichment errors without throwing", async () => {
    const repository = makeRepository();
    const onError = vi.fn();
    const enriched = await enrichAssociatedPullRequests({
      commits: [makeCommit()],
      repositoryMap: new Map([[repository.fullName, repository]]),
      concurrency: 1,
      onError,
      client: {
        getAssociatedPullRequests: async () => {
          throw new Error("boom");
        },
      },
    });

    expect(enriched[0]?.associatedPullRequests).toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });
});
