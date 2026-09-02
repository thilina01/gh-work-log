import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadLocalConfigFile,
  mergeCliOptions,
  normalizeConfig,
  parseCliArgs,
} from "../../src/config";

describe("config parsing", () => {
  it("supports repeatable and comma-separated list flags", () => {
    const options = parseCliArgs([
      "--since",
      "2026-03-01",
      "--until",
      "2026-04-01",
      "--output",
      "./report.json",
      "--emails",
      "a@example.com,b@example.com",
      "--emails",
      "c@example.com",
      "--include-repo=org/service",
      "--include-repo",
      "org/other",
      "--branch-pattern",
      "feature/*",
      "--branch-pattern",
      "prefix:release/",
    ]);

    const config = normalizeConfig(options);
    expect(config.emails).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
    expect(config.includeRepos).toEqual(["org/other", "org/service"]);
    expect(config.branchPatterns).toHaveLength(2);
    expect(config.branchPatterns[0]?.test("feature/test")).toBe(true);
    expect(config.branchPatterns[1]?.test("release/1.2.3")).toBe(true);
  });

  it("normalizes date-only ranges using inclusive since and exclusive until", () => {
    const config = normalizeConfig(
      parseCliArgs([
        "--since",
        "2026-03-01",
        "--until",
        "2026-03-31",
        "--output",
        "./report.json",
      ]),
    );

    expect(config.sinceIso).toBe("2026-03-01T00:00:00.000Z");
    expect(config.untilIso).toBe("2026-04-01T00:00:00.000Z");
  });

  it("rejects invalid ranges", () => {
    expect(() =>
      normalizeConfig(
        parseCliArgs([
          "--since",
          "2026-04-01T00:00:00.000Z",
          "--until",
          "2026-04-01T00:00:00.000Z",
          "--output",
          "./report.json",
        ]),
      ),
    ).toThrow("`--since` must be earlier than `--until`.");
  });

  it("loads local defaults and merges them with CLI flags", () => {
    const fixtureDir = mkdtempSync(path.join(tmpdir(), "gh-work-log-config-"));
    writeFileSync(
      path.join(fixtureDir, ".gh-work-log.local.json"),
      JSON.stringify({
        excludeOrgs: ["OTR-LANKA"],
        excludeRepos: ["thilina01/spring-seed"],
        emails: ["me@example.com"],
        scanFeatureBranches: true,
      }),
    );

    const merged = mergeCliOptions(
      parseCliArgs([
        "--since",
        "2026-03-01",
        "--until",
        "2026-04-01",
        "--output",
        "./report.json",
        "--exclude-repo",
        "org/service",
      ]),
      loadLocalConfigFile(fixtureDir),
    );

    const config = normalizeConfig(merged);
    expect(config.excludeOrgs).toEqual(["OTR-LANKA"]);
    expect(config.excludeRepos).toEqual([
      "org/service",
      "thilina01/spring-seed",
    ]);
    expect(config.emails).toEqual(["me@example.com"]);
    expect(config.scanFeatureBranches).toBe(true);
  });

  it("derives a default output path from the date range when --output is omitted", () => {
    const config = normalizeConfig(
      parseCliArgs(["--since", "2026-08-01", "--until", "2026-08-31"]),
    );

    expect(config.outputPath.endsWith(
      path.join("tmp", "report-20260801-20260831.json"),
    )).toBe(true);
  });

  it("still honors an explicit --output path", () => {
    const config = normalizeConfig(
      parseCliArgs([
        "--since",
        "2026-08-01",
        "--until",
        "2026-08-31",
        "--output",
        "./custom.json",
      ]),
    );

    expect(config.outputPath.endsWith("custom.json")).toBe(true);
  });

  it("supports the --html flag", () => {
    const options = parseCliArgs([
      "--since",
      "2026-03-01",
      "--until",
      "2026-04-01",
      "--output",
      "./report.json",
      "--html",
    ]);

    expect(options.html).toBe(true);
    expect(mergeCliOptions(options, {}).html).toBe(true);
  });

  it("rejects unsupported local config keys", () => {
    const fixtureDir = mkdtempSync(path.join(tmpdir(), "gh-work-log-config-"));
    writeFileSync(
      path.join(fixtureDir, ".gh-work-log.local.json"),
      JSON.stringify({
        output: "./should-not-work.json",
      }),
    );

    expect(() => loadLocalConfigFile(fixtureDir)).toThrow(
      'Unsupported key "output" in .gh-work-log.local.json.',
    );
  });
});
