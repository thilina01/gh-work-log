import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEffectiveConfigSnapshot,
  loadLocalConfigFile,
  loadWorkTrackingConfigFile,
  mergeCliOptions,
  normalizeConfig,
  parseCliArgs,
} from "../../src/config";
import { normalizeWorkTracking } from "../../src/work-tracking/config";

const RANGE = ["--since", "2026-10-01", "--until", "2026-10-31"];

function writeConfig(value: unknown): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-work-log-wt-"));
  const file = ".gh-work-log.local.json";
  fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
  return { dir, file };
}

describe("work-tracking configuration", () => {
  it("parses --enrich-tasks and --task-detail and defaults detail to full", () => {
    const local = { workTracking: { projectOwner: "acme", projectNumber: 5 } };
    const options = parseCliArgs([...RANGE, "--enrich-tasks"]);
    const config = normalizeConfig(options, local.workTracking);
    expect(config.enrichTasks).toBe(true);
    expect(config.taskDetail).toBe("full");
    expect(config.workTracking).toEqual({
      project: { ownerType: "organization", owner: "acme", number: 5 },
      taskRepository: null,
      repositoryOwners: ["acme"],
      exemptRepositories: [],
      branchTaskPattern: null,
      taskTrailer: null,
      subIssueTrailer: null,
      taskSections: ["Description", "Requirements", "Acceptance Criteria"],
      taskFields: [],
      pullRequestSections: [],
    });

    expect(normalizeConfig(parseCliArgs([...RANGE, "--enrich-tasks", "--task-detail", "Summary"]), local.workTracking).taskDetail).toBe("summary");
    expect(() => normalizeConfig(parseCliArgs([...RANGE, "--task-detail", "all"]))).toThrow(
      'Invalid --task-detail "all". Expected one of: none, summary, full.',
    );
  });

  it("requires a workTracking block when tasks are enriched", () => {
    expect(() => normalizeConfig(parseCliArgs([...RANGE, "--enrich-tasks"]))).toThrow(
      "`--enrich-tasks` requires work tracking settings with `projectOwner` and `projectNumber`",
    );
    expect(normalizeConfig(parseCliArgs(RANGE)).workTracking).toBeNull();
  });

  it("loads the block and enrichTasks/taskDetail defaults from the local config file", () => {
    const { dir, file } = writeConfig({
      enrichTasks: true,
      taskDetail: "none",
      workTracking: {
        projectOwner: "acme",
        projectNumber: 5,
        taskRepository: "acme/tasks",
        branchTaskPattern: "-wm(\\d+)-",
        exemptRepositories: ["acme/docs"],
        taskFields: ["Requested by"],
      },
    });
    const local = loadLocalConfigFile(dir, file);
    const options = mergeCliOptions(parseCliArgs(RANGE), local);
    const config = normalizeConfig(options, local.workTracking);
    expect(config.enrichTasks).toBe(true);
    expect(config.taskDetail).toBe("none");
    expect(config.workTracking).toMatchObject({
      taskRepository: "acme/tasks",
      branchTaskPattern: "-wm(\\d+)-",
      exemptRepositories: ["acme/docs"],
      taskFields: ["Requested by"],
    });

    const disabled = normalizeConfig(mergeCliOptions(parseCliArgs([...RANGE, "--no-enrich-tasks"]), local), local.workTracking);
    expect(disabled.enrichTasks).toBe(false);
  });

  it("loads --work-tracking-config files, reports their source, and works without the local config", () => {
    const { dir } = writeConfig({});
    const file = path.join(dir, "board.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ projectOwner: "acme", projectNumber: 7, taskRepository: "acme/tasks", taskFields: ["Requested by"] }),
    );
    const options = parseCliArgs([
      ...RANGE,
      "--ignore-local-config",
      "--enrich-tasks",
      "--work-tracking-config",
      file,
    ]);
    expect(options.workTrackingConfig).toBe(file);
    const block = loadWorkTrackingConfigFile(file);
    const config = normalizeConfig(options, block);
    expect(config.workTracking).toMatchObject({
      project: { owner: "acme", number: 7 },
      taskRepository: "acme/tasks",
      taskFields: ["Requested by"],
    });

    const snapshot = buildEffectiveConfigSnapshot({
      config,
      options,
      localConfig: {},
      configFilePath: null,
      configFileLoaded: false,
      workTrackingConfigPath: file,
    });
    expect(snapshot.values.workTrackingConfig).toBe(file);
    expect(snapshot.sources.workTracking).toBe("work tracking config file");
    expect(snapshot.sources.workTrackingConfig).toBe("command line");
    expect(snapshot.sources.enrichTasks).toBe("command line");

    const fromLocal = buildEffectiveConfigSnapshot({
      config,
      options: parseCliArgs(RANGE),
      localConfig: { workTracking: block },
      configFilePath: null,
      configFileLoaded: false,
    });
    expect(fromLocal.sources.workTracking).toBe("local config");
    expect(fromLocal.values.workTrackingConfig).toBeNull();
  });

  it("rejects missing or malformed --work-tracking-config files", () => {
    const { dir } = writeConfig({});
    expect(() => loadWorkTrackingConfigFile(path.join(dir, "missing.json"))).toThrow(
      "Work tracking configuration file not found",
    );
    const notJson = path.join(dir, "bad.json");
    fs.writeFileSync(notJson, "{");
    expect(() => loadWorkTrackingConfigFile(notJson)).toThrow("Failed to parse bad.json");
    const wrapped = path.join(dir, "wrapped.json");
    fs.writeFileSync(wrapped, JSON.stringify({ workTracking: { projectOwner: "acme" } }));
    expect(() => loadWorkTrackingConfigFile(wrapped)).toThrow('Unsupported key "workTracking" in wrapped.json.');
    const wrongType = path.join(dir, "type.json");
    fs.writeFileSync(wrongType, JSON.stringify({ projectNumber: "5" }));
    expect(() => loadWorkTrackingConfigFile(wrongType)).toThrow('Expected "projectNumber" in type.json to be a number.');
    const list = path.join(dir, "list.json");
    fs.writeFileSync(list, "[]");
    expect(() => loadWorkTrackingConfigFile(list)).toThrow(
      "Expected the work tracking configuration in list.json to be an object.",
    );
  });

  it("rejects malformed workTracking blocks", () => {
    const bad = writeConfig({ workTracking: { projectOwner: "o", projectNumber: 5, unknown: 1 } });
    expect(() => loadLocalConfigFile(bad.dir, bad.file)).toThrow('Unsupported key "workTracking.unknown"');
    const wrongType = writeConfig({ workTracking: { projectNumber: "5" } });
    expect(() => loadLocalConfigFile(wrongType.dir, wrongType.file)).toThrow(
      'Expected "workTracking.projectNumber" in .gh-work-log.local.json to be a number.',
    );

    expect(() => normalizeWorkTracking({ projectNumber: 5 }, true)).toThrow("`workTracking.projectOwner` is required.");
    expect(() => normalizeWorkTracking({ projectOwner: "o", projectNumber: 0 }, true)).toThrow("positive integer");
    expect(() => normalizeWorkTracking({ projectOwner: "o", projectNumber: 1, projectOwnerType: "team" }, true)).toThrow(
      '"organization" or "user"',
    );
    expect(() => normalizeWorkTracking({ projectOwner: "o", projectNumber: 1, taskRepository: "repo" }, true)).toThrow(
      "owner/name form",
    );
    expect(() =>
      normalizeWorkTracking({ projectOwner: "o", projectNumber: 1, taskRepository: "o/r", branchTaskPattern: "-wm\\d+-" }, true),
    ).toThrow("must contain a capture group");
    expect(() =>
      normalizeWorkTracking({ projectOwner: "o", projectNumber: 1, taskRepository: "o/r", branchTaskPattern: "(" }, true),
    ).toThrow("not a valid regular expression");
    expect(() => normalizeWorkTracking({ projectOwner: "o", projectNumber: 1, branchTaskPattern: "-wm(\\d+)-" }, true)).toThrow(
      "requires `workTracking.taskRepository`",
    );
  });
});
