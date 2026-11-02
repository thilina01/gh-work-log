import { RunResult } from "./types";
import { toErrorMessage } from "./utils/errors";

type JsonRecord = Record<string, unknown>;

export function parseReportJson(value: string): RunResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`Input is not valid JSON: ${toErrorMessage(error)}`);
  }
  return parseRunResult(parsed);
}

export function parseRunResult(value: unknown): RunResult {
  const report = record(value, "report");
  const metadata = record(report.metadata, "metadata");
  const statistics = record(report.statistics, "statistics");

  literal(metadata.schemaVersion, ["1.2.0", "1.3.0", "1.4.0"], "metadata.schemaVersion");
  if (metadata.schemaVersion === "1.3.0" || metadata.schemaVersion === "1.4.0") {
    literal(metadata.reportMode, ["author", "organization"], "metadata.reportMode");
  } else if (metadata.reportMode !== undefined) {
    literal(metadata.reportMode, ["author", "organization"], "metadata.reportMode");
  }
  for (const key of [
    "generatedAt",
    "authenticatedUser",
    "targetAuthor",
    "since",
    "until",
  ]) {
    string(metadata[key], `metadata.${key}`);
  }
  literal(
    metadata.scanMode,
    ["default_branch", "default_and_feature_branches"],
    "metadata.scanMode",
  );
  literal(metadata.profile, ["operator", "management", "agent"], "metadata.profile");
  for (const key of [
    "featureBranchScanEnabled",
    "detectWip",
    "includeDiffStats",
    "classifyMessages",
    "enrichPrs",
    "ignoreLocalConfig",
    "dryRun",
  ]) {
    boolean(metadata[key], `metadata.${key}`);
  }
  assertLiteral(metadata.filterField, "authoredDateTime", "metadata.filterField");
  assertLiteral(metadata.wipDetectionIsHeuristic, true, "metadata.wipDetectionIsHeuristic");

  const filters = record(metadata.filters, "metadata.filters");
  for (const key of ["includeOrgs", "excludeOrgs", "includeRepos", "excludeRepos", "branchPatterns"]) {
    stringArray(filters[key], `metadata.filters.${key}`);
  }
  boolean(filters.ownedOnly, "metadata.filters.ownedOnly");
  const tool = record(metadata.tool, "metadata.tool");
  string(tool.name, "metadata.tool.name");
  string(tool.packageVersion, "metadata.tool.packageVersion");

  const summary = record(statistics.summary, "statistics.summary");
  for (const key of [
    "repositoriesScanned",
    "repositoriesWithCommits",
    "totalCommitsCollected",
    "uniqueCommits",
    "failedRepositories",
    "skippedRepositories",
    "durationSeconds",
  ]) {
    number(summary[key], `statistics.summary.${key}`);
  }

  const discovery = record(statistics.discovery, "statistics.discovery");
  number(discovery.repositoriesDiscovered, "statistics.discovery.repositoriesDiscovered");
  number(discovery.repositoriesIncluded, "statistics.discovery.repositoriesIncluded");

  const skippedByCategory = record(statistics.skippedByCategory, "statistics.skippedByCategory");
  number(skippedByCategory.filter, "statistics.skippedByCategory.filter");
  number(skippedByCategory.operational, "statistics.skippedByCategory.operational");
  for (const [index, item] of array(statistics.skippedRepositories, "statistics.skippedRepositories").entries()) {
    const skip = record(item, `statistics.skippedRepositories[${index}]`);
    string(skip.repository, `statistics.skippedRepositories[${index}].repository`);
    string(skip.reason, `statistics.skippedRepositories[${index}].reason`);
    literal(skip.category, ["filter", "operational"], `statistics.skippedRepositories[${index}].category`);
  }

  validateHighlights(statistics.highlights);
  validateRepositories(statistics.perRepository);
  validateTimeSeries(statistics.timeSeries);
  if (statistics.contributors !== undefined) {
    validateContributors(statistics.contributors);
  }
  if (
    metadata.reportMode === "organization" &&
    statistics.contributors === undefined
  ) {
    throw new Error("Invalid report: expected statistics.contributors for organization report.");
  }
  if (
    metadata.reportMode !== "organization" &&
    statistics.contributors !== undefined
  ) {
    throw new Error("Invalid report: statistics.contributors is only valid for organization reports.");
  }
  if (statistics.codeLevel !== undefined) {
    validateCodeLevel(statistics.codeLevel, "statistics.codeLevel");
  }
  if (statistics.messageCategories !== undefined) {
    validateMessageCategories(statistics.messageCategories, "statistics.messageCategories");
  }
  if (statistics.hints !== undefined) {
    const hints = record(statistics.hints, "statistics.hints");
    for (const [index, item] of array(hints.candidateGroups, "statistics.hints.candidateGroups").entries()) {
      const group = record(item, `statistics.hints.candidateGroups[${index}]`);
      assertLiteral(group.kind, "hint", `statistics.hints.candidateGroups[${index}].kind`);
      string(group.id, `statistics.hints.candidateGroups[${index}].id`);
      string(group.reason, `statistics.hints.candidateGroups[${index}].reason`);
      for (const [commitIndex, commitValue] of array(group.commits, `statistics.hints.candidateGroups[${index}].commits`).entries()) {
        const commit = record(commitValue, `statistics.hints.candidateGroups[${index}].commits[${commitIndex}]`);
        string(commit.repository, `statistics.hints.candidateGroups[${index}].commits[${commitIndex}].repository`);
        string(commit.sha, `statistics.hints.candidateGroups[${index}].commits[${commitIndex}].sha`);
      }
    }
  }

  for (const [index, item] of array(report.failures, "failures").entries()) {
    const failure = record(item, `failures[${index}]`);
    string(failure.repository, `failures[${index}].repository`);
    string(failure.stage, `failures[${index}].stage`);
    string(failure.errorType, `failures[${index}].errorType`);
    string(failure.message, `failures[${index}].message`);
    number(failure.retryCount, `failures[${index}].retryCount`);
    if (failure.statusCode !== undefined) {
      number(failure.statusCode, `failures[${index}].statusCode`);
    }
  }
  const isOrganizationSchema14 =
    metadata.schemaVersion === "1.4.0" && metadata.reportMode === "organization";
  const isAuthorSchema14 =
    metadata.schemaVersion === "1.4.0" && metadata.reportMode === "author";
  for (const [index, item] of array(report.data, "data").entries()) {
    validateCommit(item, `data[${index}]`, {
      requireAuthorName: isOrganizationSchema14,
      forbidAuthorName: isAuthorSchema14,
    });
  }

  return value as RunResult;
}

function validateHighlights(value: unknown): void {
  const highlights = record(value, "statistics.highlights");
  for (const key of [
    "uniqueCommits",
    "repositoriesWithCommits",
    "wipShare",
    "failureCount",
    "operationalSkipCount",
    "filterSkipCount",
  ]) {
    number(highlights[key], `statistics.highlights.${key}`);
  }
  for (const [index, item] of array(highlights.topRepositories, "statistics.highlights.topRepositories").entries()) {
    const repo = record(item, `statistics.highlights.topRepositories[${index}]`);
    string(repo.repository, `statistics.highlights.topRepositories[${index}].repository`);
    number(repo.commitCount, `statistics.highlights.topRepositories[${index}].commitCount`);
  }
  if (highlights.codeLevel !== undefined) {
    validateCodeLevel(highlights.codeLevel, "statistics.highlights.codeLevel");
  }
  if (highlights.messageCategoryMix !== undefined) {
    validateMessageCategories(highlights.messageCategoryMix, "statistics.highlights.messageCategoryMix");
  }
}

function validateRepositories(value: unknown): void {
  for (const [index, item] of array(value, "statistics.perRepository").entries()) {
    const path = `statistics.perRepository[${index}]`;
    const repo = record(item, path);
    for (const key of ["repository", "defaultBranch", "firstCommitAt", "lastCommitAt"]) {
      string(repo[key], `${path}.${key}`);
    }
    for (const key of [
      "featureBranchScanEnabled",
      "commitCount",
      "wipCommitCount",
      "mergeCommitCount",
      "externalAuthorMergeCount",
    ]) {
      if (key === "featureBranchScanEnabled") {
        boolean(repo[key], `${path}.${key}`);
      } else {
        number(repo[key], `${path}.${key}`);
      }
    }
  }
}

function validateContributors(value: unknown): void {
  for (const [index, item] of array(value, "statistics.contributors").entries()) {
    const path = `statistics.contributors[${index}]`;
    const contributor = record(item, path);
    nullableString(contributor.login, `${path}.login`);
    number(contributor.commitCount, `${path}.commitCount`);
    number(contributor.repositoryCount, `${path}.repositoryCount`);
    for (const key of ["additions", "deletions"]) {
      if (contributor[key] !== undefined) {
        number(contributor[key], `${path}.${key}`);
      }
    }
  }
}

function validateTimeSeries(value: unknown): void {
  const series = record(value, "statistics.timeSeries");
  for (const key of ["byDay", "byWeek", "byMonth"]) {
    for (const [index, item] of array(series[key], `statistics.timeSeries.${key}`).entries()) {
      const bucketPath = `statistics.timeSeries.${key}[${index}]`;
      const bucket = record(item, bucketPath);
      number(bucket.commitCount, `${bucketPath}.commitCount`);
      const dateKey = key === "byDay" ? "date" : key === "byWeek" ? "weekStart" : "month";
      string(bucket[dateKey], `${bucketPath}.${dateKey}`);
    }
  }
  validateActivityBucket(series.mostActiveDay, "date", "statistics.timeSeries.mostActiveDay");
  validateActivityBucket(series.mostActiveRepository, "repository", "statistics.timeSeries.mostActiveRepository");
}

function validateActivityBucket(value: unknown, key: string, path: string): void {
  if (value === null) {
    return;
  }
  const bucket = record(value, path);
  string(bucket[key], `${path}.${key}`);
  number(bucket.commitCount, `${path}.commitCount`);
}

function validateCodeLevel(value: unknown, path: string): void {
  const codeLevel = record(value, path);
  for (const key of ["totalAdditions", "totalDeletions", "totalFilesChanged"]) {
    number(codeLevel[key], `${path}.${key}`);
  }
}

function validateMessageCategories(value: unknown, path: string): void {
  const categories = record(value, path);
  for (const key of ["feat", "fix", "refactor", "docs", "test", "chore", "other"]) {
    number(categories[key], `${path}.${key}`);
  }
}

function validateCommit(
  value: unknown,
  path: string,
  options: { requireAuthorName: boolean; forbidAuthorName: boolean },
): void {
  const commit = record(value, path);
  for (const key of [
    "repository",
    "branch",
    "scanBranch",
    "sha",
    "message",
    "authoredDateTime",
    "url",
  ]) {
    string(commit[key], `${path}.${key}`);
  }
  for (const key of ["committedDateTime", "authorLogin", "authorEmail", "mergeBranchAuthorLogin"]) {
    nullableString(commit[key], `${path}.${key}`);
  }
  if (options.requireAuthorName) {
    nullableString(commit.authorName, `${path}.authorName`);
  } else if (commit.authorName !== undefined) {
    if (options.forbidAuthorName) {
      throw new Error(`Invalid report: ${path}.authorName is not valid for author reports.`);
    }
    nullableString(commit.authorName, `${path}.authorName`);
  }
  literal(commit.sourceMode, ["default_branch", "feature_branch"], `${path}.sourceMode`);
  for (const key of ["isWip", "isMergeCommit", "mergeIncludesExternalAuthor"]) {
    boolean(commit[key], `${path}.${key}`);
  }
  if (commit.observedBranches !== undefined) {
    stringArray(commit.observedBranches, `${path}.observedBranches`);
  }
  if (commit.wipReason !== undefined) {
    string(commit.wipReason, `${path}.wipReason`);
  }
  if (commit.messageCategory !== undefined) {
    literal(commit.messageCategory, ["feat", "fix", "refactor", "docs", "test", "chore", "other"], `${path}.messageCategory`);
  }
  for (const key of ["additions", "deletions", "filesChanged"]) {
    if (commit[key] !== undefined) {
      number(commit[key], `${path}.${key}`);
    }
  }
  if (commit.associatedPullRequests !== undefined) {
    for (const [index, item] of array(commit.associatedPullRequests, `${path}.associatedPullRequests`).entries()) {
      const pullPath = `${path}.associatedPullRequests[${index}]`;
      const pull = record(item, pullPath);
      number(pull.number, `${pullPath}.number`);
      string(pull.url, `${pullPath}.url`);
      string(pull.title, `${pullPath}.title`);
      string(pull.state, `${pullPath}.state`);
    }
  }
}

function record(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid report: expected ${path} to be an object.`);
  }
  return value as JsonRecord;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid report: expected ${path} to be an array.`);
  }
  return value;
}

function string(value: unknown, path: string): void {
  if (typeof value !== "string") {
    throw new Error(`Invalid report: expected ${path} to be a string.`);
  }
}

function nullableString(value: unknown, path: string): void {
  if (value !== null) {
    string(value, path);
  }
}

function number(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid report: expected ${path} to be a finite number.`);
  }
}

function boolean(value: unknown, path: string): void {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid report: expected ${path} to be a boolean.`);
  }
}

function stringArray(value: unknown, path: string): void {
  for (const [index, item] of array(value, path).entries()) {
    string(item, `${path}[${index}]`);
  }
}

function literal<T extends string | boolean>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): asserts value is T {
  if (!allowed.includes(value as T)) {
    throw new Error(`Invalid report: unexpected value for ${path}.`);
  }
}

function assertLiteral<T extends string | boolean>(
  value: unknown,
  expected: T,
  path: string,
): asserts value is T {
  if (value !== expected) {
    throw new Error(`Invalid report: expected ${path} to be ${String(expected)}.`);
  }
}
