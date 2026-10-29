import { describe, expect, it } from "vitest";
import { classifySkipReason } from "../../src/skip-taxonomy";

describe("classifySkipReason", () => {
  it("maps filter reasons", () => {
    expect(classifySkipReason("not_in_included_orgs")).toBe("filter");
    expect(classifySkipReason("not_in_included_repositories")).toBe("filter");
    expect(classifySkipReason("excluded_org")).toBe("filter");
    expect(classifySkipReason("excluded_repository")).toBe("filter");
    expect(classifySkipReason("owned_only_mismatch")).toBe("filter");
  });

  it("maps operational reasons", () => {
    expect(classifySkipReason("disabled_repository")).toBe("operational");
    expect(classifySkipReason("missing_default_branch")).toBe("operational");
    expect(classifySkipReason("empty_repository")).toBe("operational");
  });

  it("defaults unknown reasons to operational", () => {
    expect(classifySkipReason("future_skip_reason")).toBe("operational");
  });
});
