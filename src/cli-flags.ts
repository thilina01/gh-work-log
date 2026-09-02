import { CliOptions, LocalConfigFile } from "./types";

export const DEFAULT_LOCAL_CONFIG_FILE = ".gh-work-log.local.json";
export const DEFAULT_OUTPUT_DIR = "tmp";

// -? is required here: without it, indexing a homomorphic mapped type built
// over T's optional keys leaks `undefined` into the resulting key union.
type KeysMatching<T, V> = { [K in keyof T]-?: T[K] extends V ? K : never }[keyof T];

type BooleanCliKey = KeysMatching<CliOptions, boolean>;
type SingleCliKey = KeysMatching<CliOptions, string | undefined>;
type ListCliKey = KeysMatching<CliOptions, string[]>;

export type FlagDefinition =
  | {
      flag: string;
      kind: "boolean";
      cliKey: BooleanCliKey;
      localConfigKey?: keyof LocalConfigFile;
      helpSection: string;
      helpText: string;
    }
  | {
      flag: string;
      kind: "single";
      cliKey: SingleCliKey;
      localConfigKey?: keyof LocalConfigFile;
      helpSection: string;
      helpText: string;
    }
  | {
      flag: string;
      kind: "list";
      cliKey: ListCliKey;
      localConfigKey?: keyof LocalConfigFile;
      helpSection: string;
      helpText: string;
    };

export const HELP_SECTION_ORDER = [
  "Required",
  "Output",
  "Identity",
  "Repository filters",
  "Branch scanning",
  "Enrichment",
  "Execution",
] as const;

export const FLAG_DEFINITIONS: readonly FlagDefinition[] = [
  {
    flag: "--since",
    kind: "single",
    cliKey: "since",
    helpSection: "Required",
    helpText: "Inclusive authored-date lower bound",
  },
  {
    flag: "--until",
    kind: "single",
    cliKey: "until",
    helpSection: "Required",
    helpText: "Exclusive authored-date upper bound",
  },
  {
    flag: "--output",
    kind: "single",
    cliKey: "output",
    helpSection: "Output",
    helpText: `Output JSON path (default: ${DEFAULT_OUTPUT_DIR}/report-<since>-<until>.json)`,
  },
  {
    flag: "--author",
    kind: "single",
    cliKey: "author",
    localConfigKey: "author",
    helpSection: "Identity",
    helpText: "Override target GitHub login",
  },
  {
    flag: "--emails",
    kind: "list",
    cliKey: "emails",
    localConfigKey: "emails",
    helpSection: "Identity",
    helpText: "Comma-separated or repeatable email aliases",
  },
  {
    flag: "--include-org",
    kind: "list",
    cliKey: "includeOrgs",
    localConfigKey: "includeOrgs",
    helpSection: "Repository filters",
    helpText: "Restrict to org owners",
  },
  {
    flag: "--exclude-org",
    kind: "list",
    cliKey: "excludeOrgs",
    localConfigKey: "excludeOrgs",
    helpSection: "Repository filters",
    helpText: "Exclude org owners",
  },
  {
    flag: "--include-repo",
    kind: "list",
    cliKey: "includeRepos",
    localConfigKey: "includeRepos",
    helpSection: "Repository filters",
    helpText: "Restrict to owner/name repositories",
  },
  {
    flag: "--exclude-repo",
    kind: "list",
    cliKey: "excludeRepos",
    localConfigKey: "excludeRepos",
    helpSection: "Repository filters",
    helpText: "Exclude owner/name repositories",
  },
  {
    flag: "--owned-only",
    kind: "boolean",
    cliKey: "ownedOnly",
    localConfigKey: "ownedOnly",
    helpSection: "Repository filters",
    helpText: "Keep only repositories owned by the authenticated user",
  },
  {
    flag: "--scan-feature-branches",
    kind: "boolean",
    cliKey: "scanFeatureBranches",
    localConfigKey: "scanFeatureBranches",
    helpSection: "Branch scanning",
    helpText: "Scan non-default branches too",
  },
  {
    flag: "--branch-pattern",
    kind: "list",
    cliKey: "branchPatterns",
    localConfigKey: "branchPatterns",
    helpSection: "Branch scanning",
    helpText: "Branch matcher using glob:, prefix:, or regex:",
  },
  {
    flag: "--include-diff-stats",
    kind: "boolean",
    cliKey: "includeDiffStats",
    localConfigKey: "includeDiffStats",
    helpSection: "Enrichment",
    helpText: "Fetch additions, deletions, and files changed",
  },
  {
    flag: "--detect-wip",
    kind: "boolean",
    cliKey: "detectWip",
    localConfigKey: "detectWip",
    helpSection: "Enrichment",
    helpText: "Mark commits not seen on the default branch as WIP",
  },
  {
    flag: "--classify-messages",
    kind: "boolean",
    cliKey: "classifyMessages",
    localConfigKey: "classifyMessages",
    helpSection: "Enrichment",
    helpText: "Categorize commit messages",
  },
  {
    flag: "--dry-run",
    kind: "boolean",
    cliKey: "dryRun",
    helpSection: "Execution",
    helpText: "Discover repositories without scanning commits",
  },
  {
    flag: "--html",
    kind: "boolean",
    cliKey: "html",
    helpSection: "Execution",
    helpText: "Also generate the HTML dashboard alongside the JSON output",
  },
  {
    flag: "--verbose",
    kind: "boolean",
    cliKey: "verbose",
    localConfigKey: "verbose",
    helpSection: "Execution",
    helpText: "Print verbose progress to stderr",
  },
  {
    flag: "--help",
    kind: "boolean",
    cliKey: "help",
    helpSection: "Execution",
    helpText: "Show this help text",
  },
];

export const FLAG_BY_TOKEN: ReadonlyMap<string, FlagDefinition> = new Map(
  FLAG_DEFINITIONS.map((definition) => [definition.flag, definition]),
);

export const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(
  FLAG_DEFINITIONS.filter((definition) => definition.kind === "boolean").map(
    (definition) => definition.flag,
  ),
);

export const SINGLE_VALUE_FLAGS: ReadonlySet<string> = new Set(
  FLAG_DEFINITIONS.filter((definition) => definition.kind === "single").map(
    (definition) => definition.flag,
  ),
);

export const LIST_FLAGS: ReadonlySet<string> = new Set(
  FLAG_DEFINITIONS.filter((definition) => definition.kind === "list").map(
    (definition) => definition.flag,
  ),
);

export const LOCAL_CONFIG_ALLOWED_KEYS: ReadonlySet<string> = new Set(
  FLAG_DEFINITIONS.flatMap((definition) =>
    definition.localConfigKey ? [definition.localConfigKey] : [],
  ),
);
