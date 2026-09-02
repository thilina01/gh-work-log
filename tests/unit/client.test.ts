import { describe, expect, it } from "vitest";
import { detectExternalMergeAuthor, resolveMergeBranchAuthorLogin } from "../../src/github/client";
import { TargetIdentity } from "../../src/types";

const target: TargetIdentity = {
  login: "alice",
  id: "U_1",
  emails: ["alice@example.com"],
};

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
