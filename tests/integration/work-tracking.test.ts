import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { runApp, type GitHubClientLike } from "../../src/app";
import { parseRunResult } from "../../src/report-validation";
import {
  CommitObservation,
  NormalizedConfig,
  RepositoryRecord,
  RunResult,
  TargetIdentity,
} from "../../src/types";
import { renderHtmlReport } from "../../src/visualizer/render";
import { repositoryShaKey } from "../../src/utils/collections";
import {
  DOCS,
  FakeWorkTrackingClient,
  API,
  makePull,
  makeSettings,
  WEB,
  WM,
} from "../helpers/work-tracking";

function makeConfig(overrides: Partial<NormalizedConfig> = {}): NormalizedConfig {
  return {
    since: new Date("2026-10-01T00:00:00.000Z"),
    until: new Date("2026-11-01T00:00:00.000Z"),
    sinceIso: "2026-10-01T00:00:00.000Z",
    untilIso: "2026-11-01T00:00:00.000Z",
    outputPath: "/tmp/report.json",
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
    enrichTasks: true,
    taskDetail: "full",
    workTracking: makeSettings(),
    ignoreLocalConfig: false,
    verbose: false,
    dryRun: false,
    profile: "operator",
    concurrency: 3,
    retryPolicy: { maxRetries: 0, backoffMs: [] },
    ...overrides,
  };
}

function makeRepository(fullName: string): RepositoryRecord {
  const [ownerLogin = "", name = ""] = fullName.split("/");
  return {
    fullName,
    ownerLogin,
    name,
    visibility: "private",
    defaultBranch: "main",
    isArchived: false,
    isFork: false,
    isDisabled: false,
    isPrivate: true,
    htmlUrl: `https://github.com/${fullName}`,
  };
}

function observation(repository: string, sha: string, authorLogin: string, branch = "main"): CommitObservation {
  return {
    repository,
    defaultBranch: "main",
    scanBranch: branch,
    sha,
    message: `Change ${sha} (#1)`,
    messageHeadline: `Change ${sha} (#1)`,
    authoredDateTime: "2026-10-08T11:42:01.000Z",
    committedDateTime: "2026-10-08T11:42:01.000Z",
    url: `https://github.com/${repository}/commit/${sha}`,
    sourceMode: branch === "main" ? "default_branch" : "feature_branch",
    authorLogin,
    authorName: authorLogin,
    authorEmail: `${authorLogin}@example.com`,
    parentCount: 1,
    mergeIncludesExternalAuthor: false,
    mergeBranchAuthorLogin: null,
  };
}

/** Scans plus work tracking; commits by `alice` and `bob` across three repositories. */
class FakeClient extends FakeWorkTrackingClient implements GitHubClientLike {
  public failBoard = false;

  public constructor(private readonly observations: CommitObservation[]) {
    super(
      undefined,
      undefined,
      undefined,
      new Map([[repositoryShaKey(WEB, "shaA"), [makePull(WEB, 210, { body: "Parent-Task: #200", repository: WEB })]]]),
    );
  }

  public override async getProjectBoard() {
    if (this.failBoard) {
      throw new Error("Your token has not been granted the required scopes to execute this query.");
    }
    return super.getProjectBoard();
  }

  public async validateGhInstallation(): Promise<void> {}
  public async validateAuthentication(): Promise<void> {}
  public async getAuthenticatedUser() {
    return { login: "alice", id: "U_1" };
  }
  public async resolveTargetIdentity(
    requestedAuthor: string | undefined,
    user: { login: string; id: string },
    emails: string[],
  ): Promise<TargetIdentity> {
    return { login: requestedAuthor ?? user.login, id: user.id, emails };
  }
  public async listRepositories(): Promise<RepositoryRecord[]> {
    return [makeRepository(DOCS), makeRepository(API), makeRepository(WEB)];
  }
  public async listBranches(): Promise<string[]> {
    return ["main"];
  }
  public async listBranchCommits(params: { repository: RepositoryRecord; branch: string }) {
    return {
      observations: this.observations.filter(
        (entry) => entry.repository === params.repository.fullName && entry.scanBranch === params.branch,
      ),
      missingRef: false,
    };
  }
  public async getCommitDiffStats() {
    return { additions: 1, deletions: 1, filesChanged: 1 };
  }
}

function makeObservations(): CommitObservation[] {
  return [
    observation(WEB, "sha175", "alice"),
    observation(API, "sha62", "bob"),
    observation(WEB, "shaA", "alice"),
    observation(WEB, "shaE", "bob"),
    observation(DOCS, "shaG", "bob"),
  ];
}

async function runWith(client: FakeClient, overrides: Partial<NormalizedConfig> = {}): Promise<RunResult> {
  let written: RunResult | undefined;
  const result = await runApp(makeConfig(overrides), {
    client,
    writeJson: async (_path, value) => {
      written = value;
    },
  });
  expect(written).toBe(result);
  return result;
}

describe("runApp with --enrich-tasks", () => {
  it("links commits in an author report and writes a valid 1.5.0 report", async () => {
    const client = new FakeClient(makeObservations());
    const result = await runWith(client);

    expect(result.metadata).toMatchObject({ schemaVersion: "1.5.0", enrichTasks: true, taskDetail: "full" });
    expect(result.data.map((commit) => [commit.sha, commit.workLink?.task ?? commit.workLink?.unlinkedReason])).toEqual([
      ["sha62", `${WM}#125`],
      ["shaG", "exempt_repository"],
      ["sha175", `${WM}#125`],
      ["shaA", `${WM}#200`],
      ["shaE", "no_pull_request"],
    ]);
    expect(result.workTracking?.coverage).toMatchObject({ commits: 5, linked: 3, unlinked: 2 });
    expect(Object.keys(result.workTracking?.tasks ?? {})).toEqual([`${WM}#125`, `${WM}#200`]);
    expect(result.workTracking?.board.snapshotAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.workTracking?.settings).toEqual(makeSettings());
    expect(client.calls.board).toBe(1);

    const roundTrip = parseRunResult(JSON.parse(JSON.stringify(result)));
    expect(roundTrip.workTracking?.tasks[`${WM}#125`]?.title).toBe("Web - Order history");
  });

  it("adds per-task contributors in organization reports without emails", async () => {
    const client = new FakeClient(makeObservations());
    const result = await runWith(client, { organizationReport: true, includeOrgs: ["acme"] });

    expect(result.metadata.reportMode).toBe("organization");
    expect(result.workTracking?.tasks[`${WM}#125`]?.activity?.authors).toEqual([
      { login: "alice", commitCount: 1 },
      { login: "bob", commitCount: 1 },
    ]);
    expect(JSON.stringify(result)).not.toContain("@example.com");
    parseRunResult(JSON.parse(JSON.stringify(result)));
  });

  it("fails early with the project scope hint when the board cannot be read", async () => {
    const client = new FakeClient(makeObservations());
    client.failBoard = true;
    await expect(runWith(client)).rejects.toThrow(
      /could not read project acme\/5: .*required scopes.*gh auth refresh -h github\.com -s project/,
    );
  });

  it("does not load the board for a dry run", async () => {
    const client = new FakeClient(makeObservations());
    const result = await runWith(client, { dryRun: true });
    expect(client.calls.board).toBe(0);
    expect(result.workTracking).toBeUndefined();
    parseRunResult(JSON.parse(JSON.stringify(result)));
  });

  it("omits work tracking when the flag is off", async () => {
    const client = new FakeClient(makeObservations());
    const result = await runWith(client, { enrichTasks: false });
    expect(client.calls.board).toBe(0);
    expect(result.metadata.enrichTasks).toBe(false);
    expect(result.metadata.taskDetail).toBeUndefined();
    expect(result.data.every((commit) => commit.workLink === undefined)).toBe(true);
  });

  it("shows a task chip on linked commits in the dashboard", async () => {
    const client = new FakeClient(makeObservations());
    const result = await runWith(client);
    const dom = new JSDOM(renderHtmlReport(result), { runScripts: "dangerously" });
    const chips = Array.from(dom.window.document.querySelectorAll<HTMLAnchorElement>("a.task-chip"));
    expect(chips.map((chip) => chip.textContent)).toEqual(expect.arrayContaining(["#125", "#200"]));
    expect(chips.find((chip) => chip.textContent === "#125")?.title).toBe(
      `${WM}#125 - Web - Order history (Done)`,
    );
    dom.window.close();
  });
});

describe("schema 1.5.0 validation", () => {
  async function validReport(): Promise<RunResult> {
    return JSON.parse(JSON.stringify(await runWith(new FakeClient(makeObservations())))) as RunResult;
  }

  it("rejects broken references and inconsistent links", async () => {
    const missingTask = await validReport();
    delete missingTask.workTracking!.tasks[`${WM}#200`];
    expect(() => parseRunResult(missingTask)).toThrow("data[3].workLink.task does not reference a task record.");

    const badLink = await validReport();
    badLink.data[4]!.workLink!.task = `${WM}#125`;
    expect(() => parseRunResult(badLink)).toThrow("is unlinked but names a task");

    const missingSection = await validReport();
    delete missingSection.workTracking;
    expect(() => parseRunResult(missingSection)).toThrow("expected workTracking when metadata.enrichTasks is true.");

    const missingSettings = await validReport();
    delete (missingSettings.workTracking as Partial<NonNullable<RunResult["workTracking"]>>).settings;
    expect(() => parseRunResult(missingSettings)).toThrow("expected workTracking.settings to be an object.");

    const missingFlag = await validReport();
    delete missingFlag.metadata.enrichTasks;
    expect(() => parseRunResult(missingFlag)).toThrow("expected metadata.enrichTasks to be a boolean.");

    const strayLink = await validReport();
    strayLink.metadata.enrichTasks = false;
    delete strayLink.metadata.taskDetail;
    delete strayLink.workTracking;
    expect(() => parseRunResult(strayLink)).toThrow("data[0].workLink is only valid when metadata.enrichTasks is true.");
  });
});
