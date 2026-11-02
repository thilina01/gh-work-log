import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEffectiveConfigSnapshot,
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
        "--no-scan-feature-branches",
        "--exclude-repo",
        "org/service",
      ]),
      loadLocalConfigFile(fixtureDir),
    );

    const config = normalizeConfig(merged);
    expect(config.excludeOrgs).toEqual(["OTR-LANKA"]);
    expect(config.excludeRepos).toEqual(["org/service"]);
    expect(config.emails).toEqual(["me@example.com"]);
    expect(config.scanFeatureBranches).toBe(false);
  });

  it("uses repeatable CLI list values as overrides for local list defaults", () => {
    const options = parseCliArgs([
      "--since",
      "2026-03-01",
      "--until",
      "2026-04-01",
      "--include-org",
      "cli-one",
      "--include-org=cli-two",
    ]);

    const merged = mergeCliOptions(options, {
      includeOrgs: ["local-org"],
      includeRepos: ["local/repo"],
    });

    expect(merged.includeOrgs).toEqual(["cli-one", "cli-two"]);
    expect(merged.includeRepos).toEqual(["local/repo"]);
  });

  it("accepts generic negated boolean flags", () => {
    const options = parseCliArgs([
      "--since",
      "2026-03-01",
      "--until",
      "2026-04-01",
      "--no-scan-feature-branches",
      "--no-include-diff-stats",
    ]);

    expect(options.scanFeatureBranches).toBe(false);
    expect(options.includeDiffStats).toBe(false);
    expect(() => parseCliArgs(["--no-not-a-flag"])).toThrow(
      'Unknown flag "--no-not-a-flag".',
    );
  });

  it("loads an explicitly selected config file and errors when it is missing", () => {
    const fixtureDir = mkdtempSync(path.join(tmpdir(), "gh-work-log-config-path-"));
    const filePath = path.join(fixtureDir, "settings.json");
    writeFileSync(filePath, JSON.stringify({ includeOrgs: ["org"] }));

    expect(loadLocalConfigFile(fixtureDir, filePath, true)).toEqual({
      includeOrgs: ["org"],
    });
    expect(() =>
      loadLocalConfigFile(fixtureDir, path.join(fixtureDir, "missing.json"), true),
    ).toThrow(`Configuration file not found: ${path.join(fixtureDir, "missing.json")}`);
  });

  it("builds a normalized config preview with source information and redacted emails", () => {
    const localConfig = { scanFeatureBranches: true, emails: ["private@example.com"] };
    const options = mergeCliOptions(
      parseCliArgs([
        "--since",
        "2026-03-01",
        "--until",
        "2026-04-01",
        "--no-scan-feature-branches",
        "--show-config",
      ]),
      localConfig,
    );
    const snapshot = buildEffectiveConfigSnapshot({
      config: normalizeConfig(options),
      options,
      localConfig,
      configFilePath: "/tmp/settings.json",
      configFileLoaded: true,
    });

    expect(snapshot.values.scanFeatureBranches).toBe(false);
    expect(snapshot.sources.scanFeatureBranches).toBe("command line");
    expect(snapshot.sources.emails).toBe("local config");
    expect(snapshot.values.emails).toEqual({
      count: 1,
      values: ["<redacted>"],
    });
    expect(JSON.stringify(snapshot)).not.toContain("private@example.com");
  });

  it("defaults profile to operator and accepts valid profile values", () => {
    const defaultConfig = normalizeConfig(
      parseCliArgs(["--since", "2026-03-01", "--until", "2026-04-01"]),
    );
    expect(defaultConfig.profile).toBe("operator");
    expect(defaultConfig.ignoreLocalConfig).toBe(false);
    expect(defaultConfig.enrichPrs).toBe(false);

    const managementConfig = normalizeConfig(
      parseCliArgs([
        "--since",
        "2026-03-01",
        "--until",
        "2026-04-01",
        "--profile",
        "management",
      ]),
    );
    expect(managementConfig.profile).toBe("management");
  });

  it("parses --ignore-local-config and --enrich-prs", () => {
    const config = normalizeConfig(
      parseCliArgs([
        "--since",
        "2026-03-01",
        "--until",
        "2026-04-01",
        "--ignore-local-config",
        "--enrich-prs",
        "--owned-only",
      ]),
    );
    expect(config.ignoreLocalConfig).toBe(true);
    expect(config.enrichPrs).toBe(true);
    expect(config.ownedOnly).toBe(true);
  });

  it("can merge without local defaults when ignoreLocalConfig is used at CLI layer", () => {
    const fixtureDir = mkdtempSync(path.join(tmpdir(), "gh-work-log-ignore-local-"));
    writeFileSync(
      path.join(fixtureDir, ".gh-work-log.local.json"),
      JSON.stringify({
        includeOrgs: ["OTR-Lanka"],
      }),
    );

    const parsed = parseCliArgs([
      "--since",
      "2026-03-01",
      "--until",
      "2026-04-01",
      "--ignore-local-config",
      "--owned-only",
    ]);
    const localConfig = parsed.ignoreLocalConfig ? {} : loadLocalConfigFile(fixtureDir);
    const config = normalizeConfig(mergeCliOptions(parsed, localConfig));

    expect(config.includeOrgs).toEqual([]);
    expect(config.ownedOnly).toBe(true);
    expect(config.ignoreLocalConfig).toBe(true);
    expect(loadLocalConfigFile(fixtureDir).includeOrgs).toEqual(["OTR-Lanka"]);
  });

  it("rejects invalid profile values", () => {
    expect(() =>
      normalizeConfig(
        parseCliArgs([
          "--since",
          "2026-03-01",
          "--until",
          "2026-04-01",
          "--profile",
          "executive",
        ]),
      ),
    ).toThrow('Invalid --profile "executive"');
  });

  it("derives a default output path from the date range when --output is omitted", () => {
    const config = normalizeConfig(
      parseCliArgs(["--since", "2026-08-01", "--until", "2026-08-31"]),
    );

    expect(config.outputPath.endsWith(
      path.join("tmp", "report-20260801-20260831.json"),
    )).toBe(true);
  });

  it("includes the requested author in the default output path", () => {
    const alice = normalizeConfig(
      parseCliArgs([
        "--since",
        "2026-08-01",
        "--until",
        "2026-08-31",
        "--author",
        "Alice",
      ]),
    );
    const bob = normalizeConfig(
      parseCliArgs([
        "--since",
        "2026-08-01",
        "--until",
        "2026-08-31",
        "--author",
        "bob",
      ]),
    );

    expect(alice.outputPath.endsWith(
      path.join("tmp", "report-alice-20260801-20260831.json"),
    )).toBe(true);
    expect(bob.outputPath.endsWith(
      path.join("tmp", "report-bob-20260801-20260831.json"),
    )).toBe(true);
    expect(alice.outputPath).not.toBe(bob.outputPath);
  });

  it("requires an included organization and rejects an author in organization-report mode", () => {
    expect(() =>
      normalizeConfig(
        parseCliArgs([
          "--since",
          "2026-03-01",
          "--until",
          "2026-04-01",
          "--organization-report",
        ]),
      ),
    ).toThrow("`--organization-report` requires at least one `--include-org`.");

    expect(() =>
      normalizeConfig(
        parseCliArgs([
          "--since",
          "2026-03-01",
          "--until",
          "2026-04-01",
          "--organization-report",
          "--include-org",
          "org",
          "--author",
          "alice",
        ]),
      ),
    ).toThrow("`--organization-report` cannot be combined with `--author`.");

    const config = normalizeConfig(
      parseCliArgs([
        "--since",
        "2026-03-01",
        "--until",
        "2026-04-01",
        "--organization-report",
        "--include-org",
        "Acme",
        "--include-org",
        "Other Org",
      ]),
    );
    expect(config.organizationReport).toBe(true);
    expect(config.outputPath).toContain("report-org-acme_other-org-");
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
