import { TaskDetailLevel, WorkTrackingLocalConfig, WorkTrackingSettings } from "./types";

const ALLOWED_KEYS: ReadonlySet<keyof WorkTrackingLocalConfig> = new Set<keyof WorkTrackingLocalConfig>([
  "projectOwner",
  "projectOwnerType",
  "projectNumber",
  "taskRepository",
  "repositoryOwners",
  "exemptRepositories",
  "branchTaskPattern",
  "taskTrailer",
  "subIssueTrailer",
  "taskSections",
  "taskFields",
  "pullRequestSections",
]);

const STRING_KEYS = [
  "projectOwner",
  "projectOwnerType",
  "taskRepository",
  "branchTaskPattern",
  "taskTrailer",
  "subIssueTrailer",
] as const;

const LIST_KEYS = [
  "repositoryOwners",
  "exemptRepositories",
  "taskSections",
  "taskFields",
  "pullRequestSections",
] as const;

export const DEFAULT_TASK_SECTIONS = ["Description", "Requirements", "Acceptance Criteria"];

/**
 * Validates a raw `workTracking` object. `prefix` is how keys are named in
 * errors: "workTracking." for the local config block, "" for a
 * `--work-tracking-config` file that holds the object itself.
 */
export function parseWorkTrackingLocalConfig(
  value: unknown,
  fileName: string,
  prefix = "workTracking.",
): WorkTrackingLocalConfig {
  const label = prefix ? prefix.slice(0, -1) : "the work tracking configuration";
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${prefix ? `"${label}"` : label} in ${fileName} to be an object.`);
  }
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key as keyof WorkTrackingLocalConfig)) {
      throw new Error(`Unsupported key "${prefix}${key}" in ${fileName}.`);
    }
  }
  const result: WorkTrackingLocalConfig = {};
  for (const key of STRING_KEYS) {
    const entry = raw[key];
    if (entry === undefined) {
      continue;
    }
    if (typeof entry !== "string") {
      throw new Error(`Expected "${prefix}${key}" in ${fileName} to be a string.`);
    }
    result[key] = entry;
  }
  for (const key of LIST_KEYS) {
    const entry = raw[key];
    if (entry === undefined) {
      continue;
    }
    if (!Array.isArray(entry) || !entry.every((item) => typeof item === "string")) {
      throw new Error(`Expected "${prefix}${key}" in ${fileName} to be an array of strings.`);
    }
    result[key] = [...entry];
  }
  if (raw.projectNumber !== undefined) {
    if (typeof raw.projectNumber !== "number") {
      throw new Error(`Expected "${prefix}projectNumber" in ${fileName} to be a number.`);
    }
    result.projectNumber = raw.projectNumber;
  }
  return result;
}

export function parseTaskDetail(value: string | undefined): TaskDetailLevel {
  if (value === undefined || value.trim() === "") {
    return "full";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized !== "none" && normalized !== "summary" && normalized !== "full") {
    throw new Error(`Invalid --task-detail "${value}". Expected one of: none, summary, full.`);
  }
  return normalized;
}

/**
 * Normalizes the `workTracking` block. Returns null when it is absent;
 * throws when `enrichTasks` is requested without a usable block.
 */
export function normalizeWorkTracking(
  local: WorkTrackingLocalConfig | undefined,
  enrichTasks: boolean,
): WorkTrackingSettings | null {
  if (!local) {
    if (enrichTasks) {
      throw new Error(
        "`--enrich-tasks` requires work tracking settings with `projectOwner` and `projectNumber`: a `workTracking` block in the local config file, or a `--work-tracking-config` file.",
      );
    }
    return null;
  }

  const owner = local.projectOwner?.trim();
  if (!owner) {
    throw new Error("`workTracking.projectOwner` is required.");
  }
  const number = local.projectNumber;
  if (number === undefined || !Number.isInteger(number) || number <= 0) {
    throw new Error("`workTracking.projectNumber` must be a positive integer.");
  }
  const ownerType = (local.projectOwnerType ?? "organization").trim().toLowerCase();
  if (ownerType !== "organization" && ownerType !== "user") {
    throw new Error('`workTracking.projectOwnerType` must be "organization" or "user".');
  }
  const taskRepository = local.taskRepository?.trim() || null;
  if (taskRepository && !/^[^/\s]+\/[^/\s]+$/.test(taskRepository)) {
    throw new Error("`workTracking.taskRepository` must be in owner/name form.");
  }
  for (const repository of local.exemptRepositories ?? []) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(repository.trim())) {
      throw new Error(`\`workTracking.exemptRepositories\` entry "${repository}" must be in owner/name form.`);
    }
  }
  const branchTaskPattern = local.branchTaskPattern?.trim() || null;
  if (branchTaskPattern) {
    let groups: number;
    try {
      groups = (new RegExp(`${branchTaskPattern}|`).exec("")?.length ?? 1) - 1;
    } catch (error) {
      throw new Error(`\`workTracking.branchTaskPattern\` is not a valid regular expression: ${String(error)}`);
    }
    if (groups < 1) {
      throw new Error("`workTracking.branchTaskPattern` must contain a capture group for the task number.");
    }
    if (!taskRepository) {
      throw new Error("`workTracking.branchTaskPattern` requires `workTracking.taskRepository`.");
    }
  }

  return {
    project: { ownerType, owner, number },
    taskRepository,
    repositoryOwners: normalizeList(local.repositoryOwners ?? [owner]),
    exemptRepositories: normalizeList(local.exemptRepositories ?? []),
    branchTaskPattern,
    taskTrailer: local.taskTrailer?.trim() || null,
    subIssueTrailer: local.subIssueTrailer?.trim() || null,
    taskSections: cleanNames(local.taskSections ?? DEFAULT_TASK_SECTIONS),
    taskFields: cleanNames(local.taskFields ?? []),
    pullRequestSections: cleanNames(local.pullRequestSections ?? []),
  };
}

function normalizeList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
}

/** Keeps configured order (it is the output order) and drops blanks and duplicates. */
function cleanNames(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
