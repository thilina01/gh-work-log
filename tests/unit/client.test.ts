import { describe, expect, it } from "vitest";
import {
  detectExternalMergeAuthor,
  mapRepository,
  resolveMergeBranchAuthorLogin,
} from "../../src/github/client";
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
