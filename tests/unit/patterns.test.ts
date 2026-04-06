import { describe, expect, it } from "vitest";
import { compileBranchPattern, matchesBranch } from "../../src/utils/patterns";

describe("branch pattern matching", () => {
  it("supports glob patterns by default", () => {
    const matcher = compileBranchPattern("feature/*");
    expect(matcher.test("feature/api")).toBe(true);
    expect(matcher.test("release/api")).toBe(false);
  });

  it("supports prefix and regex modes", () => {
    const prefix = compileBranchPattern("prefix:release/");
    const regex = compileBranchPattern("regex:^bugfix/[0-9]+$");

    expect(prefix.test("release/2026.04")).toBe(true);
    expect(regex.test("bugfix/42")).toBe(true);
    expect(matchesBranch("bugfix/42", [prefix, regex])).toBe(true);
  });
});
