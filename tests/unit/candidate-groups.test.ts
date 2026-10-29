import { describe, expect, it } from "vitest";
import { buildCandidateGroupHints } from "../../src/hints/candidate-groups";
import { CommitRecord } from "../../src/types";

function makeCommit(overrides: Partial<CommitRecord>): CommitRecord {
  return {
    repository: "org/service",
    branch: "main",
    scanBranch: "main",
    sha: "sha",
    message: "feat: change",
    authoredDateTime: "2026-03-02T10:00:00.000Z",
    committedDateTime: "2026-03-02T10:01:00.000Z",
    url: "https://github.com/org/service/commit/sha",
    sourceMode: "default_branch",
    authorLogin: "alice",
    authorEmail: "alice@example.com",
    isWip: false,
    isMergeCommit: false,
    mergeIncludesExternalAuthor: false,
    mergeBranchAuthorLogin: null,
    messageCategory: "feat",
    ...overrides,
  };
}

describe("buildCandidateGroupHints", () => {
  it("groups commits that share an issue key", () => {
    const groups = buildCandidateGroupHints([
      makeCommit({
        repository: "org/foo-api",
        sha: "aaa",
        message: "feat: handle #42 assembly",
      }),
      makeCommit({
        repository: "org/foo-client",
        sha: "bbb",
        message: "feat: show assembly for #42",
        authoredDateTime: "2026-03-03T10:00:00.000Z",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe("hint");
    expect(groups[0]?.reason).toContain("42");
    expect(groups[0]?.commits).toEqual([
      { repository: "org/foo-api", sha: "aaa" },
      { repository: "org/foo-client", sha: "bbb" },
    ]);
  });

  it("groups same-day api/client stems", () => {
    const groups = buildCandidateGroupHints([
      makeCommit({
        repository: "org/barcode-api",
        sha: "aaa",
        message: "feat: api",
      }),
      makeCommit({
        repository: "org/barcode-client",
        sha: "bbb",
        message: "feat: ui",
      }),
    ]);

    expect(groups.some((group) => group.reason.includes("barcode"))).toBe(true);
  });

  it("skips chore-only groups when classifications are present", () => {
    const groups = buildCandidateGroupHints([
      makeCommit({
        sha: "aaa",
        message: "chore: bump",
        messageCategory: "chore",
        repository: "org/foo-api",
      }),
      makeCommit({
        sha: "bbb",
        message: "chore: bump again",
        messageCategory: "chore",
        repository: "org/foo-client",
      }),
    ]);

    expect(groups).toEqual([]);
  });

  it("is deterministic across runs", () => {
    const commits = [
      makeCommit({
        repository: "org/foo-api",
        sha: "aaa",
        message: "feat: task/7 work",
      }),
      makeCommit({
        repository: "org/foo-client",
        sha: "bbb",
        message: "feat: task/7 ui",
      }),
    ];

    expect(buildCandidateGroupHints(commits)).toEqual(
      buildCandidateGroupHints([...commits].reverse()),
    );
  });
});
