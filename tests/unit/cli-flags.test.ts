import { describe, expect, it } from "vitest";
import { FLAG_DEFINITIONS } from "../../src/cli-flags";
import { CliOptions } from "../../src/types";

// A compile-time forcing function: if a field is ever added to or removed
// from CliOptions, this literal fails to typecheck until updated, which
// keeps this test (and therefore FLAG_DEFINITIONS) honest.
const ALL_CLI_OPTION_KEYS: Record<keyof CliOptions, true> = {
  since: true,
  until: true,
  output: true,
  author: true,
  emails: true,
  includeOrgs: true,
  excludeOrgs: true,
  includeRepos: true,
  excludeRepos: true,
  branchPatterns: true,
  ownedOnly: true,
  scanFeatureBranches: true,
  includeDiffStats: true,
  detectWip: true,
  classifyMessages: true,
  verbose: true,
  dryRun: true,
  html: true,
  help: true,
};

describe("FLAG_DEFINITIONS stays in sync with CliOptions", () => {
  it("has exactly one definition per CliOptions field", () => {
    const registeredKeys = new Set(FLAG_DEFINITIONS.map((definition) => definition.cliKey));

    expect(registeredKeys).toEqual(new Set(Object.keys(ALL_CLI_OPTION_KEYS)));
  });
});
