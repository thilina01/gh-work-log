import fs from "node:fs";
import path from "node:path";
import {
  BOOLEAN_FLAGS,
  DEFAULT_LOCAL_CONFIG_FILE,
  DEFAULT_OUTPUT_DIR,
  FLAG_BY_TOKEN,
  FLAG_DEFINITIONS,
  HELP_SECTION_ORDER,
  LIST_FLAGS,
  LOCAL_CONFIG_ALLOWED_KEYS,
  SINGLE_VALUE_FLAGS,
} from "./cli-flags";
import {
  CliOptions,
  LocalConfigFile,
  NormalizedConfig,
  ReportProfile,
} from "./types";
import { splitFlagToken } from "./utils/cli-tokens";
import { assertSinceBeforeUntil, parseSince, parseUntil } from "./utils/dates";
import { toErrorMessage } from "./utils/errors";
import { compileBranchPatterns } from "./utils/patterns";
import { optionalBoolean, optionalString, optionalStringArray } from "./utils/validation";
import {
  normalizeWorkTracking,
  parseTaskDetail,
  parseWorkTrackingLocalConfig,
} from "./work-tracking/config";
import { WorkTrackingLocalConfig } from "./work-tracking/types";

export { DEFAULT_LOCAL_CONFIG_FILE, DEFAULT_OUTPUT_DIR };

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    emails: [],
    includeOrgs: [],
    excludeOrgs: [],
    includeRepos: [],
    excludeRepos: [],
    branchPatterns: [],
    ownedOnly: false,
    organizationReport: false,
    scanFeatureBranches: false,
    includeDiffStats: false,
    detectWip: false,
    classifyMessages: false,
    enrichPrs: false,
    enrichTasks: false,
    ignoreLocalConfig: false,
    verbose: false,
    dryRun: false,
    html: false,
    showConfig: false,
    help: false,
    explicitOptions: new Set<string>(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument "${token}".`);
    }

    const [flag, inlineValue] = splitFlagToken(token);

    if (BOOLEAN_FLAGS.has(flag)) {
      setBooleanFlag(options, flag);
      continue;
    }

    if (flag.startsWith("--no-")) {
      const positiveFlag = `--${flag.slice("--no-".length)}`;
      if (!BOOLEAN_FLAGS.has(positiveFlag) || inlineValue !== undefined) {
        throw new Error(`Unknown flag "${flag}".`);
      }
      setBooleanFlag(options, positiveFlag, false);
      continue;
    }

    const value = inlineValue ?? argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Flag "${flag}" requires a value.`);
    }

    index += inlineValue === undefined ? 1 : 0;

    if (SINGLE_VALUE_FLAGS.has(flag)) {
      setSingleValueFlag(options, flag, value);
      continue;
    }

    if (LIST_FLAGS.has(flag)) {
      setListValueFlag(options, flag, value);
      continue;
    }

    throw new Error(`Unknown flag "${flag}".`);
  }

  return options;
}

export function loadLocalConfigFile(
  cwd: string = process.cwd(),
  fileName: string = DEFAULT_LOCAL_CONFIG_FILE,
  mustExist = false,
): LocalConfigFile {
  const filePath = path.resolve(cwd, fileName);
  if (!fs.existsSync(filePath)) {
    if (mustExist) {
      throw new Error(`Configuration file not found: ${filePath}`);
    }
    return {};
  }

  const raw = fs.readFileSync(filePath, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse ${fileName}: ${toErrorMessage(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Expected ${fileName} to contain a JSON object.`);
  }

  return validateLocalConfigFile(parsed, fileName);
}

/**
 * Loads a file that holds only a `workTracking` object (the same keys as the
 * local config file's `workTracking` block). Used by `--work-tracking-config`.
 */
export function loadWorkTrackingConfigFile(filePath: string): WorkTrackingLocalConfig {
  const fileName = path.basename(filePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Work tracking configuration file not found: ${filePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse ${fileName}: ${toErrorMessage(error)}`);
  }
  return parseWorkTrackingLocalConfig(parsed, fileName, "");
}

export function mergeCliOptions(
  cliOptions: CliOptions,
  localConfig: LocalConfigFile,
): CliOptions {
  const merged: CliOptions = { ...cliOptions };
  const explicitOptions = cliOptions.explicitOptions ?? new Set<string>();

  for (const definition of FLAG_DEFINITIONS) {
    if (!definition.localConfigKey) {
      continue;
    }

    const localValue = localConfig[definition.localConfigKey];
    const cliValue = cliOptions[definition.cliKey];
    const cliWasProvided =
      explicitOptions.has(definition.cliKey) ||
      (definition.kind === "list" && Array.isArray(cliValue) && cliValue.length > 0) ||
      (definition.kind === "boolean" && cliValue === true) ||
      (definition.kind === "single" && cliValue !== undefined);
    if (localValue === undefined || cliWasProvided) {
      continue;
    }

    if (definition.kind === "list") {
      if (!Array.isArray(localValue)) {
        throw new Error(`Invalid local configuration value for ${definition.localConfigKey}.`);
      }
      merged[definition.cliKey] = [...localValue];
    } else if (definition.kind === "boolean") {
      if (typeof localValue !== "boolean") {
        throw new Error(`Invalid local configuration value for ${definition.localConfigKey}.`);
      }
      merged[definition.cliKey] = localValue;
    } else {
      if (typeof localValue !== "string") {
        throw new Error(`Invalid local configuration value for ${definition.localConfigKey}.`);
      }
      merged[definition.cliKey] = cliOptions[definition.cliKey] ?? localValue;
    }
  }

  return merged;
}

export function buildEffectiveConfigSnapshot(params: {
  config: NormalizedConfig;
  options: CliOptions;
  localConfig: LocalConfigFile;
  configFilePath: string | null;
  configFileLoaded: boolean;
  workTrackingConfigPath?: string | null;
}): {
  configFile: { path: string | null; loaded: boolean };
  values: Record<string, unknown>;
  sources: Record<string, string>;
} {
  const { config, options, localConfig } = params;
  const sources: Record<string, string> = {};
  const explicitOptions = options.explicitOptions ?? new Set<string>();

  for (const definition of FLAG_DEFINITIONS) {
    if (definition.cliKey === "showConfig" || definition.cliKey === "help") {
      continue;
    }

    sources[definition.cliKey] = explicitOptions.has(definition.cliKey)
      ? "command line"
      : definition.localConfigKey &&
          localConfig[definition.localConfigKey] !== undefined
        ? "local config"
        : "default";
  }

  return {
    configFile: {
      path: params.configFilePath,
      loaded: params.configFileLoaded,
    },
    values: {
      since: config.sinceIso,
      until: config.untilIso,
      output: config.outputPath,
      author: config.requestedAuthor ?? "authenticated GitHub user",
      emails: {
        count: config.emails.length,
        values: config.emails.map(() => "<redacted>"),
      },
      includeOrgs: config.includeOrgs,
      excludeOrgs: config.excludeOrgs,
      includeRepos: config.includeRepos,
      excludeRepos: config.excludeRepos,
      ownedOnly: config.ownedOnly,
      organizationReport: config.organizationReport,
      scanFeatureBranches: config.scanFeatureBranches,
      branchPatterns: config.branchPatterns.map((pattern) => pattern.input),
      includeDiffStats: config.includeDiffStats,
      detectWip: config.detectWip,
      classifyMessages: config.classifyMessages,
      enrichPrs: config.enrichPrs,
      enrichTasks: config.enrichTasks,
      taskDetail: config.taskDetail,
      workTrackingConfig: params.workTrackingConfigPath ?? null,
      workTracking: config.workTracking,
      ignoreLocalConfig: config.ignoreLocalConfig,
      dryRun: config.dryRun,
      html: options.html,
      profile: config.profile,
      verbose: config.verbose,
      concurrency: config.concurrency,
      retryPolicy: config.retryPolicy,
    },
    sources: {
      ...sources,
      configFile: options.configFile ? "command line" : "default",
      workTracking: params.workTrackingConfigPath
        ? "work tracking config file"
        : localConfig.workTracking !== undefined
          ? "local config"
          : "default",
      concurrency: "built-in",
      retryPolicy: "built-in",
    },
  };
}

export function normalizeConfig(
  options: CliOptions,
  workTracking?: WorkTrackingLocalConfig,
): NormalizedConfig {
  if (!options.since || !options.until) {
    throw new Error("`--since` and `--until` are required.");
  }

  const since = parseSince(options.since);
  const until = parseUntil(options.until);
  assertSinceBeforeUntil(since, until);
  const requestedAuthor = options.author?.trim();
  const includeOrgs = normalizeList(options.includeOrgs);

  if (options.organizationReport && includeOrgs.length === 0) {
    throw new Error(
      "`--organization-report` requires at least one `--include-org`.",
    );
  }
  if (options.organizationReport && requestedAuthor) {
    throw new Error("`--organization-report` cannot be combined with `--author`.");
  }

  return {
    since,
    until,
    sinceIso: since.toISOString(),
    untilIso: until.toISOString(),
    outputPath: path.resolve(
      options.output ??
        defaultOutputPath(
          since,
          until,
          requestedAuthor,
          options.organizationReport ? includeOrgs : [],
        ),
    ),
    ...(requestedAuthor ? { requestedAuthor } : {}),
    emails: normalizeList(options.emails),
    includeOrgs,
    excludeOrgs: normalizeList(options.excludeOrgs),
    includeRepos: normalizeList(options.includeRepos),
    excludeRepos: normalizeList(options.excludeRepos),
    branchPatterns: compileBranchPatterns(normalizeList(options.branchPatterns)),
    ownedOnly: options.ownedOnly,
    scanFeatureBranches: options.scanFeatureBranches,
    includeDiffStats: options.includeDiffStats,
    detectWip: options.detectWip,
    classifyMessages: options.classifyMessages,
    enrichPrs: options.enrichPrs,
    enrichTasks: options.enrichTasks,
    taskDetail: parseTaskDetail(options.taskDetail),
    workTracking: normalizeWorkTracking(workTracking, options.enrichTasks),
    ignoreLocalConfig: options.ignoreLocalConfig,
    verbose: options.verbose,
    dryRun: options.dryRun,
    profile: parseReportProfile(options.profile),
    organizationReport: options.organizationReport,
    concurrency: 5,
    retryPolicy: {
      maxRetries: 3,
      backoffMs: [1000, 2000, 4000],
    },
  };
}

function parseReportProfile(value: string | undefined): ReportProfile {
  if (value === undefined || value.trim() === "") {
    return "operator";
  }

  const normalized = value.trim().toLowerCase();
  if (!isReportProfile(normalized)) {
    throw new Error(
      `Invalid --profile "${value}". Expected one of: operator, management, agent.`,
    );
  }

  return normalized;
}

function isReportProfile(value: string): value is ReportProfile {
  return value === "operator" || value === "management" || value === "agent";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function renderHelp(): string {
  const lines: string[] = [
    "Usage: gh-work-log --since <iso|date> --until <iso|date> [--output <file>] [options]",
    `Optional local defaults: ${DEFAULT_LOCAL_CONFIG_FILE}`,
    "Boolean flags also accept --no-<flag> to override a local true value.",
  ];

  for (const section of HELP_SECTION_ORDER) {
    lines.push("", `${section}:`);
    for (const definition of FLAG_DEFINITIONS) {
      if (definition.helpSection === section) {
        lines.push(`  ${definition.flag.padEnd(25)}${definition.helpText}`);
      }
    }
  }

  return lines.join("\n");
}

function defaultOutputPath(
  since: Date,
  until: Date,
  requestedAuthor?: string,
  includedOrgs: string[] = [],
): string {
  const sinceKey = formatUtcDateKey(since);
  const lastIncludedDay = new Date(until.getTime() - 1);
  const untilKey = formatUtcDateKey(lastIncludedDay);
  const scopePart = includedOrgs.length > 0
    ? `-org-${includedOrgs
        .map((org) => org.toLowerCase().replace(/[^a-z0-9-]/g, "-"))
        .join("_")}`
    : requestedAuthor
    ? `-${requestedAuthor.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`
    : "";
  return path.join(
    DEFAULT_OUTPUT_DIR,
    `report${scopePart}-${sinceKey}-${untilKey}.json`,
  );
}

function formatUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function normalizeList(values: string[]): string[] {
  const normalized = values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set(normalized)).sort((left, right) =>
    left.localeCompare(right),
  );
}

function setBooleanFlag(
  options: CliOptions,
  flag: string,
  value = true,
): void {
  const definition = FLAG_BY_TOKEN.get(flag);
  if (definition?.kind !== "boolean") {
    throw new Error(`Unknown boolean flag "${flag}".`);
  }

  options[definition.cliKey] = value;
  options.explicitOptions?.add(definition.cliKey);
}

function setSingleValueFlag(
  options: CliOptions,
  flag: string,
  value: string,
): void {
  const definition = FLAG_BY_TOKEN.get(flag);
  if (definition?.kind !== "single") {
    throw new Error(`Unknown single-value flag "${flag}".`);
  }

  options[definition.cliKey] = value;
  options.explicitOptions?.add(definition.cliKey);
}

function setListValueFlag(options: CliOptions, flag: string, value: string): void {
  const definition = FLAG_BY_TOKEN.get(flag);
  if (definition?.kind !== "list") {
    throw new Error(`Unknown list flag "${flag}".`);
  }

  options[definition.cliKey].push(value);
  options.explicitOptions?.add(definition.cliKey);
}

function validateLocalConfigFile(
  value: Record<string, unknown>,
  fileName: string,
): LocalConfigFile {
  for (const key of Object.keys(value)) {
    if (!LOCAL_CONFIG_ALLOWED_KEYS.has(key)) {
      throw new Error(`Unsupported key "${key}" in ${fileName}.`);
    }
  }

  const result: Partial<Record<keyof LocalConfigFile, string | string[] | boolean>> = {};

  for (const definition of FLAG_DEFINITIONS) {
    if (!definition.localConfigKey) {
      continue;
    }

    const raw = value[definition.localConfigKey];
    if (definition.kind === "boolean") {
      const parsed = optionalBoolean(
        raw,
        definition.localConfigKey,
        fileName,
      );
      if (parsed !== undefined) {
        result[definition.localConfigKey] = parsed;
      }
    } else if (definition.kind === "list") {
      const parsed = optionalStringArray(
        raw,
        definition.localConfigKey,
        fileName,
      );
      if (parsed !== undefined) {
        result[definition.localConfigKey] = parsed;
      }
    } else {
      const parsed = optionalString(
        raw,
        definition.localConfigKey,
        fileName,
      );
      if (parsed !== undefined) {
        result[definition.localConfigKey] = parsed;
      }
    }
  }

  if (value.workTracking !== undefined) {
    return {
      ...(result as LocalConfigFile),
      workTracking: parseWorkTrackingLocalConfig(value.workTracking, fileName),
    };
  }

  return result as LocalConfigFile;
}
