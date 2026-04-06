import fs from "node:fs";
import path from "node:path";
import { CliOptions, LocalConfigFile, NormalizedConfig } from "./types";
import { assertSinceBeforeUntil, parseSince, parseUntil } from "./utils/dates";
import { compileBranchPatterns } from "./utils/patterns";

export const DEFAULT_LOCAL_CONFIG_FILE = ".gh-work-log.local.json";

const BOOLEAN_FLAGS = new Set([
  "--owned-only",
  "--scan-feature-branches",
  "--include-diff-stats",
  "--detect-wip",
  "--classify-messages",
  "--verbose",
  "--dry-run",
  "--help",
]);

const SINGLE_VALUE_FLAGS = new Set(["--since", "--until", "--output", "--author"]);
const LIST_FLAGS = new Set([
  "--emails",
  "--include-org",
  "--exclude-org",
  "--include-repo",
  "--exclude-repo",
  "--branch-pattern",
]);

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

    const [flag, inlineValue] = splitInlineValue(token);

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
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${fileName}: ${message}`);
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
  return {
    since: cliOptions.since,
    until: cliOptions.until,
    output: cliOptions.output,
    author: cliOptions.author ?? localConfig.author,
    emails: [...(localConfig.emails ?? []), ...cliOptions.emails],
    includeOrgs: [...(localConfig.includeOrgs ?? []), ...cliOptions.includeOrgs],
    excludeOrgs: [...(localConfig.excludeOrgs ?? []), ...cliOptions.excludeOrgs],
    includeRepos: [...(localConfig.includeRepos ?? []), ...cliOptions.includeRepos],
    excludeRepos: [...(localConfig.excludeRepos ?? []), ...cliOptions.excludeRepos],
    branchPatterns: [
      ...(localConfig.branchPatterns ?? []),
      ...cliOptions.branchPatterns,
    ],
    ownedOnly: Boolean(localConfig.ownedOnly) || cliOptions.ownedOnly,
    scanFeatureBranches:
      Boolean(localConfig.scanFeatureBranches) || cliOptions.scanFeatureBranches,
    includeDiffStats:
      Boolean(localConfig.includeDiffStats) || cliOptions.includeDiffStats,
    detectWip: Boolean(localConfig.detectWip) || cliOptions.detectWip,
    classifyMessages:
      Boolean(localConfig.classifyMessages) || cliOptions.classifyMessages,
    verbose: Boolean(localConfig.verbose) || cliOptions.verbose,
    dryRun: cliOptions.dryRun,
    help: cliOptions.help,
  };
}

export function normalizeConfig(options: CliOptions): NormalizedConfig {
  if (options.help) {
    throw new Error("");
  }

  if (!options.since || !options.until || !options.output) {
    throw new Error("`--since`, `--until`, and `--output` are required.");
  }

  const since = parseSince(options.since);
  const until = parseUntil(options.until);
  assertSinceBeforeUntil(since, until);

  return {
    since,
    until,
    sinceIso: since.toISOString(),
    untilIso: until.toISOString(),
    outputPath: path.resolve(options.output),
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
  return [
    "Usage: gh-work-log --since <iso|date> --until <iso|date> --output <file> [options]",
    `Optional local defaults: ${DEFAULT_LOCAL_CONFIG_FILE}`,
    "",
    "Required:",
    "  --since                  Inclusive authored-date lower bound",
    "  --until                  Exclusive authored-date upper bound",
    "  --output                 Output JSON path",
    "",
    "Identity:",
    "  --author                 Override target GitHub login",
    "  --emails                 Comma-separated or repeatable email aliases",
    "",
    "Repository filters:",
    "  --include-org            Restrict to org owners",
    "  --exclude-org            Exclude org owners",
    "  --include-repo           Restrict to owner/name repositories",
    "  --exclude-repo           Exclude owner/name repositories",
    "  --owned-only             Keep only repositories owned by the authenticated user",
    "",
    "Branch scanning:",
    "  --scan-feature-branches  Scan non-default branches too",
    "  --branch-pattern         Branch matcher using glob:, prefix:, or regex:",
    "",
    "Enrichment:",
    "  --include-diff-stats     Fetch additions, deletions, and files changed",
    "  --detect-wip             Mark commits not seen on the default branch as WIP",
    "  --classify-messages      Categorize commit messages",
    "",
    "Execution:",
    "  --dry-run                Discover repositories without scanning commits",
    "  --verbose                Print verbose progress to stderr",
    "  --help                   Show this help text",
  ].join("\n");
}

function splitInlineValue(token: string): [string, string | undefined] {
  const separatorIndex = token.indexOf("=");
  if (separatorIndex === -1) {
    return [token, undefined];
  }

  return [token.slice(0, separatorIndex), token.slice(separatorIndex + 1)];
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
  switch (flag) {
    case "--owned-only":
      options.ownedOnly = true;
      break;
    case "--scan-feature-branches":
      options.scanFeatureBranches = true;
      break;
    case "--include-diff-stats":
      options.includeDiffStats = true;
      break;
    case "--detect-wip":
      options.detectWip = true;
      break;
    case "--classify-messages":
      options.classifyMessages = true;
      break;
    case "--verbose":
      options.verbose = true;
      break;
    case "--dry-run":
      options.dryRun = true;
      break;
    case "--help":
      options.help = true;
      break;
    default:
      throw new Error(`Unknown boolean flag "${flag}".`);
  }
}

function setSingleValueFlag(
  options: CliOptions,
  flag: string,
  value: string,
): void {
  switch (flag) {
    case "--since":
      options.since = value;
      break;
    case "--until":
      options.until = value;
      break;
    case "--output":
      options.output = value;
      break;
    case "--author":
      options.author = value;
      break;
    default:
      throw new Error(`Unknown single-value flag "${flag}".`);
  }
}

function setListValueFlag(options: CliOptions, flag: string, value: string): void {
  switch (flag) {
    case "--emails":
      options.emails.push(value);
      break;
    case "--include-org":
      options.includeOrgs.push(value);
      break;
    case "--exclude-org":
      options.excludeOrgs.push(value);
      break;
    case "--include-repo":
      options.includeRepos.push(value);
      break;
    case "--exclude-repo":
      options.excludeRepos.push(value);
      break;
    case "--branch-pattern":
      options.branchPatterns.push(value);
      break;
    default:
      throw new Error(`Unknown list flag "${flag}".`);
  }
}

function validateLocalConfigFile(
  value: Record<string, unknown>,
  fileName: string,
): LocalConfigFile {
  const allowedKeys = new Set([
    "author",
    "emails",
    "includeOrgs",
    "excludeOrgs",
    "includeRepos",
    "excludeRepos",
    "branchPatterns",
    "ownedOnly",
    "scanFeatureBranches",
    "includeDiffStats",
    "detectWip",
    "classifyMessages",
    "verbose",
  ]);

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unsupported key "${key}" in ${fileName}.`);
    }
  }

  const author = optionalString(value.author, "author", fileName);

  return {
    author,
    emails: optionalStringArray(value.emails, "emails", fileName),
    includeOrgs: optionalStringArray(value.includeOrgs, "includeOrgs", fileName),
    excludeOrgs: optionalStringArray(value.excludeOrgs, "excludeOrgs", fileName),
    includeRepos: optionalStringArray(value.includeRepos, "includeRepos", fileName),
    excludeRepos: optionalStringArray(value.excludeRepos, "excludeRepos", fileName),
    branchPatterns: optionalStringArray(
      value.branchPatterns,
      "branchPatterns",
      fileName,
    ),
    ownedOnly: optionalBoolean(value.ownedOnly, "ownedOnly", fileName),
    scanFeatureBranches: optionalBoolean(
      value.scanFeatureBranches,
      "scanFeatureBranches",
      fileName,
    ),
    includeDiffStats: optionalBoolean(
      value.includeDiffStats,
      "includeDiffStats",
      fileName,
    ),
    detectWip: optionalBoolean(value.detectWip, "detectWip", fileName),
    classifyMessages: optionalBoolean(
      value.classifyMessages,
      "classifyMessages",
      fileName,
    ),
    verbose: optionalBoolean(value.verbose, "verbose", fileName),
  };
}

function optionalString(
  value: unknown,
  key: string,
  fileName: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Expected "${key}" in ${fileName} to be a string.`);
  }

  return value;
}

function optionalStringArray(
  value: unknown,
  key: string,
  fileName: string,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Expected "${key}" in ${fileName} to be an array of strings.`);
  }

  return value;
}

function optionalBoolean(
  value: unknown,
  key: string,
  fileName: string,
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Expected "${key}" in ${fileName} to be a boolean.`);
  }

  return value;
}
