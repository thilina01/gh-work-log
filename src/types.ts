export type ScanMode = "default_branch" | "default_and_feature_branches";
export type SourceMode = "default_branch" | "feature_branch";
export type ReportProfile = "operator" | "management" | "agent";
export type SkipCategory = "filter" | "operational";
export type MessageCategory =
  | "feat"
  | "fix"
  | "refactor"
  | "docs"
  | "test"
  | "chore"
  | "other";

export interface CliOptions {
  since?: string;
  until?: string;
  output?: string;
  author?: string;
  emails: string[];
  includeOrgs: string[];
  excludeOrgs: string[];
  includeRepos: string[];
  excludeRepos: string[];
  branchPatterns: string[];
  ownedOnly: boolean;
  scanFeatureBranches: boolean;
  includeDiffStats: boolean;
  detectWip: boolean;
  classifyMessages: boolean;
  enrichPrs: boolean;
  ignoreLocalConfig: boolean;
  verbose: boolean;
  dryRun: boolean;
  html: boolean;
  help: boolean;
  profile?: string;
}

export interface LocalConfigFile {
  author?: string;
  emails?: string[];
  includeOrgs?: string[];
  excludeOrgs?: string[];
  includeRepos?: string[];
  excludeRepos?: string[];
  branchPatterns?: string[];
  ownedOnly?: boolean;
  scanFeatureBranches?: boolean;
  includeDiffStats?: boolean;
  detectWip?: boolean;
  classifyMessages?: boolean;
  verbose?: boolean;
  profile?: string;
}

export interface BranchMatcher {
  mode: "glob" | "prefix" | "regex";
  input: string;
  test(branch: string): boolean;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number[];
}

export interface NormalizedConfig {
  since: Date;
  until: Date;
  sinceIso: string;
  untilIso: string;
  outputPath: string;
  requestedAuthor?: string;
  emails: string[];
  includeOrgs: string[];
  excludeOrgs: string[];
  includeRepos: string[];
  excludeRepos: string[];
  branchPatterns: BranchMatcher[];
  ownedOnly: boolean;
  scanFeatureBranches: boolean;
  includeDiffStats: boolean;
  detectWip: boolean;
  classifyMessages: boolean;
  enrichPrs: boolean;
  ignoreLocalConfig: boolean;
  verbose: boolean;
  dryRun: boolean;
  profile: ReportProfile;
  concurrency: number;
  retryPolicy: RetryPolicy;
}

export interface ToolIdentity {
  name: string;
  packageVersion: string;
}

export interface AssociatedPullRequest {
  number: number;
  url: string;
  title: string;
  state: string;
}

export interface CandidateGroupHint {
  kind: "hint";
  id: string;
  reason: string;
  commits: Array<{ repository: string; sha: string }>;
}

export interface ReportHints {
  /** Non-authoritative triage groupings for agent profiles only. */
  candidateGroups: CandidateGroupHint[];
}

export interface AuthenticatedUser {
  login: string;
  id: string;
}

export interface RepositoryRecord {
  fullName: string;
  ownerLogin: string;
  name: string;
  visibility: string;
  defaultBranch: string | null;
  isArchived: boolean;
  isFork: boolean;
  isDisabled: boolean;
  isPrivate: boolean;
  htmlUrl: string;
}

/** Raw skip recorded during discovery/scan before category packaging. */
export interface SkipRecord {
  repository: string;
  reason: string;
}

export interface SkippedRepository extends SkipRecord {
  category: SkipCategory;
}

export interface SkippedByCategory {
  filter: number;
  operational: number;
}

export interface ReportFilters {
  includeOrgs: string[];
  excludeOrgs: string[];
  includeRepos: string[];
  excludeRepos: string[];
  ownedOnly: boolean;
  branchPatterns: string[];
}

export interface ReportHighlights {
  topRepositories: Array<{ repository: string; commitCount: number }>;
  uniqueCommits: number;
  repositoriesWithCommits: number;
  wipShare: number;
  failureCount: number;
  operationalSkipCount: number;
  filterSkipCount: number;
  messageCategoryMix?: MessageCategorySummary;
  codeLevel?: CodeLevelSummary;
}

export interface FailureRecord {
  repository: string;
  stage: string;
  errorType: string;
  statusCode?: number;
  message: string;
  retryCount: number;
}

export interface CommitDiffStats {
  additions: number;
  deletions: number;
  filesChanged: number;
}

export interface CommitObservation extends Partial<CommitDiffStats> {
  repository: string;
  defaultBranch: string;
  scanBranch: string;
  sha: string;
  message: string;
  messageHeadline: string;
  authoredDateTime: string;
  committedDateTime: string | null;
  url: string;
  sourceMode: SourceMode;
  authorLogin: string | null;
  authorEmail: string | null;
  parentCount: number;
  mergeIncludesExternalAuthor: boolean;
  mergeBranchAuthorLogin: string | null;
}

export interface CommitRecord extends Partial<CommitDiffStats> {
  repository: string;
  branch: string;
  scanBranch: string;
  observedBranches?: string[];
  sha: string;
  message: string;
  authoredDateTime: string;
  committedDateTime: string | null;
  url: string;
  sourceMode: SourceMode;
  authorLogin: string | null;
  authorEmail: string | null;
  isWip: boolean;
  wipReason?: string;
  isMergeCommit: boolean;
  mergeIncludesExternalAuthor: boolean;
  mergeBranchAuthorLogin: string | null;
  messageCategory?: MessageCategory;
  /** Inspection hint only; never treat title/state as profile evidence. */
  associatedPullRequests?: AssociatedPullRequest[];
}

export interface RepositorySummary {
  repository: string;
  defaultBranch: string;
  featureBranchScanEnabled: boolean;
  commitCount: number;
  firstCommitAt: string;
  lastCommitAt: string;
  wipCommitCount: number;
  mergeCommitCount: number;
  externalAuthorMergeCount: number;
}

export interface StatisticsSummary {
  repositoriesScanned: number;
  repositoriesWithCommits: number;
  totalCommitsCollected: number;
  uniqueCommits: number;
  failedRepositories: number;
  skippedRepositories: number;
  durationSeconds: number;
}

export interface TimeSeriesBucket {
  date?: string;
  weekStart?: string;
  month?: string;
  commitCount: number;
}

export interface TimeSeriesSummary {
  byDay: TimeSeriesBucket[];
  byWeek: TimeSeriesBucket[];
  byMonth: TimeSeriesBucket[];
  mostActiveDay: { date: string; commitCount: number } | null;
  mostActiveRepository: { repository: string; commitCount: number } | null;
}

export interface CodeLevelSummary {
  totalAdditions: number;
  totalDeletions: number;
  totalFilesChanged: number;
}

export interface MessageCategorySummary {
  feat: number;
  fix: number;
  refactor: number;
  docs: number;
  test: number;
  chore: number;
  other: number;
}

export interface DiscoverySummary {
  repositoriesDiscovered: number;
  /**
   * Repositories that passed org/repo/owned-only filtering, counted before
   * the per-repository viability checks (disabled repository, missing
   * default branch) that can still move a repository into
   * `skippedRepositories`.
   */
  repositoriesIncluded: number;
}

export interface Statistics {
  summary: StatisticsSummary;
  discovery: DiscoverySummary;
  skippedByCategory: SkippedByCategory;
  skippedRepositories: SkippedRepository[];
  highlights: ReportHighlights;
  perRepository: RepositorySummary[];
  timeSeries: TimeSeriesSummary;
  codeLevel?: CodeLevelSummary;
  messageCategories?: MessageCategorySummary;
  /** Present only for the agent profile. */
  hints?: ReportHints;
}

export interface RunMetadata {
  schemaVersion: "1.2.0";
  generatedAt: string;
  authenticatedUser: string;
  targetAuthor: string;
  since: string;
  until: string;
  scanMode: ScanMode;
  featureBranchScanEnabled: boolean;
  detectWip: boolean;
  includeDiffStats: boolean;
  classifyMessages: boolean;
  enrichPrs: boolean;
  ignoreLocalConfig: boolean;
  dryRun: boolean;
  profile: ReportProfile;
  filters: ReportFilters;
  filterField: "authoredDateTime";
  wipDetectionIsHeuristic: true;
  tool: ToolIdentity;
}

export interface RunResult {
  metadata: RunMetadata;
  statistics: Statistics;
  failures: FailureRecord[];
  data: CommitRecord[];
}

export interface GitHubRunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandRunner {
  run(
    command: string,
    args: string[],
    options?: { input?: string },
  ): Promise<GitHubRunnerResult>;
}

export interface TargetIdentity {
  login: string;
  id: string;
  emails: string[];
}
