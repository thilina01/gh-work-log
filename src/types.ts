export type ScanMode = "default_branch" | "default_and_feature_branches";
export type SourceMode = "default_branch" | "feature_branch";
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
  verbose: boolean;
  dryRun: boolean;
  help: boolean;
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
  verbose: boolean;
  dryRun: boolean;
  concurrency: number;
  retryPolicy: RetryPolicy;
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

export interface SkippedRepository {
  repository: string;
  reason: string;
}

export interface FailureRecord {
  repository: string;
  stage: string;
  errorType: string;
  statusCode?: number;
  message: string;
  retryCount: number;
}

export interface CommitObservation {
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
  additions?: number;
  deletions?: number;
  filesChanged?: number;
}

export interface CommitDiffStats {
  additions: number;
  deletions: number;
  filesChanged: number;
}

export interface CommitRecord {
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
  isWip: boolean;
  wipReason?: string;
  additions?: number;
  deletions?: number;
  filesChanged?: number;
  messageCategory?: MessageCategory;
}

export interface RepositorySummary {
  repository: string;
  defaultBranch: string;
  featureBranchScanEnabled: boolean;
  commitCount: number;
  firstCommitAt: string;
  lastCommitAt: string;
  wipCommitCount: number;
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
  repositoriesIncluded: number;
}

export interface Statistics {
  summary: StatisticsSummary;
  discovery: DiscoverySummary;
  skippedRepositories: SkippedRepository[];
  perRepository: RepositorySummary[];
  timeSeries: TimeSeriesSummary;
  codeLevel?: CodeLevelSummary;
  messageCategories?: MessageCategorySummary;
}

export interface RunMetadata {
  schemaVersion: "1.0.0";
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
  dryRun: boolean;
  filterField: "authoredDateTime";
  wipDetectionIsHeuristic: true;
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
