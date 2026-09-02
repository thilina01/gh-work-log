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
import { CliOptions, LocalConfigFile, NormalizedConfig } from "./types";
import { splitFlagToken } from "./utils/cli-tokens";
import { assertSinceBeforeUntil, parseSince, parseUntil } from "./utils/dates";
import { toErrorMessage } from "./utils/errors";
import { compileBranchPatterns } from "./utils/patterns";
import { optionalBoolean, optionalString, optionalStringArray } from "./utils/validation";

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
    scanFeatureBranches: false,
    includeDiffStats: false,
    detectWip: false,
    classifyMessages: false,
    verbose: false,
    dryRun: false,
    html: false,
    help: false,
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
): LocalConfigFile {
  const filePath = path.join(cwd, fileName);
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const raw = fs.readFileSync(filePath, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse ${fileName}: ${toErrorMessage(error)}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected ${fileName} to contain a JSON object.`);
  }

  return validateLocalConfigFile(parsed as Record<string, unknown>, fileName);
}

export function mergeCliOptions(
  cliOptions: CliOptions,
  localConfig: LocalConfigFile,
): CliOptions {
  const merged: CliOptions = { ...cliOptions };

  for (const definition of FLAG_DEFINITIONS) {
    if (!definition.localConfigKey) {
      continue;
    }

    const localValue = localConfig[definition.localConfigKey];
    if (localValue === undefined) {
      continue;
    }

    if (definition.kind === "list") {
      merged[definition.cliKey] = [
        ...(localValue as string[]),
        ...cliOptions[definition.cliKey],
      ];
    } else if (definition.kind === "boolean") {
      merged[definition.cliKey] = Boolean(localValue) || cliOptions[definition.cliKey];
    } else {
      merged[definition.cliKey] = cliOptions[definition.cliKey] ?? (localValue as string);
    }
  }

  return merged;
}

export function normalizeConfig(options: CliOptions): NormalizedConfig {
  if (!options.since || !options.until) {
    throw new Error("`--since` and `--until` are required.");
  }

  const since = parseSince(options.since);
  const until = parseUntil(options.until);
  assertSinceBeforeUntil(since, until);

  return {
    since,
    until,
    sinceIso: since.toISOString(),
    untilIso: until.toISOString(),
    outputPath: path.resolve(options.output ?? defaultOutputPath(since, until)),
    requestedAuthor: options.author?.trim() || undefined,
    emails: normalizeList(options.emails),
    includeOrgs: normalizeList(options.includeOrgs),
    excludeOrgs: normalizeList(options.excludeOrgs),
    includeRepos: normalizeList(options.includeRepos),
    excludeRepos: normalizeList(options.excludeRepos),
    branchPatterns: compileBranchPatterns(normalizeList(options.branchPatterns)),
    ownedOnly: options.ownedOnly,
    scanFeatureBranches: options.scanFeatureBranches,
    includeDiffStats: options.includeDiffStats,
    detectWip: options.detectWip,
    classifyMessages: options.classifyMessages,
    verbose: options.verbose,
    dryRun: options.dryRun,
    concurrency: 5,
    retryPolicy: {
      maxRetries: 3,
      backoffMs: [1000, 2000, 4000],
    },
  };
}

export function renderHelp(): string {
  const lines: string[] = [
    "Usage: gh-work-log --since <iso|date> --until <iso|date> [--output <file>] [options]",
    `Optional local defaults: ${DEFAULT_LOCAL_CONFIG_FILE}`,
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

function defaultOutputPath(since: Date, until: Date): string {
  const sinceKey = formatUtcDateKey(since);
  const lastIncludedDay = new Date(until.getTime() - 1);
  const untilKey = formatUtcDateKey(lastIncludedDay);
  return path.join(DEFAULT_OUTPUT_DIR, `report-${sinceKey}-${untilKey}.json`);
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

function setBooleanFlag(options: CliOptions, flag: string): void {
  const definition = FLAG_BY_TOKEN.get(flag);
  if (definition?.kind !== "boolean") {
    throw new Error(`Unknown boolean flag "${flag}".`);
  }

  options[definition.cliKey] = true;
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
}

function setListValueFlag(options: CliOptions, flag: string, value: string): void {
  const definition = FLAG_BY_TOKEN.get(flag);
  if (definition?.kind !== "list") {
    throw new Error(`Unknown list flag "${flag}".`);
  }

  options[definition.cliKey].push(value);
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
      result[definition.localConfigKey] = optionalBoolean(
        raw,
        definition.localConfigKey,
        fileName,
      );
    } else if (definition.kind === "list") {
      result[definition.localConfigKey] = optionalStringArray(
        raw,
        definition.localConfigKey,
        fileName,
      );
    } else {
      result[definition.localConfigKey] = optionalString(
        raw,
        definition.localConfigKey,
        fileName,
      );
    }
  }

  return result as LocalConfigFile;
}

