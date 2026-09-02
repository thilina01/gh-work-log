import { RunResult } from "../types";
import {
  escapeAttribute,
  escapeHtml,
  formatDate,
  formatNumber,
  humanize,
  titleCase,
  totalExternalAuthorMergeCount,
  totalMergeCommitCount,
  totalWipCount,
} from "./helpers";

export function renderHero(report: RunResult): string {
  const summary = report.statistics.summary;

  return `<section class="hero">
        <div class="panel hero-main">
          <div class="eyebrow">GitHub Work Log</div>
          <h1>${escapeHtml(report.metadata.targetAuthor)} across ${summary.repositoriesWithCommits} repositories</h1>
          <p class="lede">
            This report covers commits authored between <strong>${formatDate(report.metadata.since)}</strong> and
            <strong>${formatDate(report.metadata.until)}</strong>. The dashboard below turns the exported JSON into
            a readable activity snapshot: volume over time, most active repositories, recent commits, and anything skipped or failed.
          </p>
          <div class="meta-grid">
            <div class="meta-pill"><strong>Generated</strong><br />${formatDate(report.metadata.generatedAt)}</div>
            <div class="meta-pill"><strong>Authenticated User</strong><br />${escapeHtml(report.metadata.authenticatedUser)}</div>
            <div class="meta-pill"><strong>Scan Mode</strong><br />${humanize(report.metadata.scanMode)}</div>
            <div class="meta-pill"><strong>Feature Branches</strong><br />${report.metadata.featureBranchScanEnabled ? "Enabled" : "Disabled"}</div>
          </div>
        </div>
        <aside class="panel hero-side">
          <div class="score">
            <div class="score-label">Unique Commits</div>
            <strong>${formatNumber(summary.uniqueCommits)}</strong>
          </div>
          <div class="score">
            <div class="score-label">Observed Before Dedup</div>
            <strong>${formatNumber(summary.totalCommitsCollected)}</strong>
          </div>
          <div class="score">
            <div class="score-label">Execution Time</div>
            <strong>${summary.durationSeconds}s</strong>
          </div>
        </aside>
      </section>`;
}

export function renderMetricCards(report: RunResult): string {
  const summary = report.statistics.summary;
  const discovery = report.statistics.discovery;

  return `<section class="cards">
        ${metricCard("Repositories Discovered", discovery.repositoriesDiscovered, "Everything returned by discovery queries")}
        ${metricCard("Repositories Scanned", summary.repositoriesScanned, "After filter and metadata checks")}
        ${metricCard("Repositories With Commits", summary.repositoriesWithCommits, "Repos with at least one matching commit")}
        ${metricCard("Skipped Repositories", summary.skippedRepositories, "Filtered, empty, or otherwise skipped")}
        ${metricCard("Failures", summary.failedRepositories, "Repositories that could not be processed")}
        ${metricCard("WIP Commits", totalWipCount(report), report.metadata.detectWip ? "Heuristic WIP detection enabled" : "WIP detection disabled in this run")}
        ${metricCard("Merge Commits", totalMergeCommitCount(report), "Commits with more than one parent, typically produced by merging a pull request")}
        ${metricCard("External-Author Merges", totalExternalAuthorMergeCount(report), "Merge commits whose incoming branch tip was authored by someone other than the target author")}
      </section>`;
}

export function renderTabStrip(): string {
  return `<section class="tab-strip" aria-label="Report views">
        <button class="tab-button is-active" type="button" data-tab="overview-panel">Overview</button>
        <button class="tab-button" type="button" data-tab="activity-panel">Activity</button>
        <button class="tab-button" type="button" data-tab="repositories-panel">Repositories</button>
        <button class="tab-button" type="button" data-tab="issues-panel">Issues</button>
        <button class="tab-button" type="button" data-tab="commits-panel">All Commits</button>
      </section>`;
}

export function renderOverviewTab(report: RunResult): string {
  const summary = report.statistics.summary;
  const discovery = report.statistics.discovery;

  return `<section id="overview-panel" class="tab-panel is-active">
        <div class="stack stack--wide">
          <div class="panel section">
            <div class="section-header">
              <div>
                <h2 class="section-title">Run Summary</h2>
                <p class="section-copy">A compact snapshot of the scan outcome, with the major totals kept in one place before you dive into the detailed tabs.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>Repositories discovered</td><td>${formatNumber(discovery.repositoriesDiscovered)}</td></tr>
                  <tr><td>Repositories scanned</td><td>${formatNumber(summary.repositoriesScanned)}</td></tr>
                  <tr><td>Repositories with commits</td><td>${formatNumber(summary.repositoriesWithCommits)}</td></tr>
                  <tr><td>Unique commits</td><td>${formatNumber(summary.uniqueCommits)}</td></tr>
                  <tr><td>Skipped repositories</td><td>${formatNumber(summary.skippedRepositories)}</td></tr>
                  <tr><td>Failures</td><td>${formatNumber(summary.failedRepositories)}</td></tr>
                  <tr><td>Most active day</td><td>${escapeHtml(report.statistics.timeSeries.mostActiveDay?.date ?? "No data")}</td></tr>
                  <tr><td>Most active repository</td><td>${escapeHtml(report.statistics.timeSeries.mostActiveRepository?.repository ?? "No data")}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>`;
}

export function renderActivityTab(report: RunResult): string {
  return `<section id="activity-panel" class="tab-panel">
        <div class="panel section">
          <div class="section-header">
            <div>
              <h2 class="section-title">Activity Rhythm</h2>
              <p class="section-copy">The charts are stacked full-width here so the daily and weekly patterns are easier to read without the old cramped two-column layout.</p>
            </div>
            <div class="chip">${escapeHtml(report.statistics.timeSeries.mostActiveRepository?.repository ?? "No repository data")}</div>
          </div>
          <div class="chart-stack">
            ${chartCard("By Day", "Daily commit volume across the selected range.", report.statistics.timeSeries.byDay, "date", "commitCount", "#127475", "wide")}
            ${chartCard("By Week", "Week starts are normalized to Monday 00:00 UTC.", report.statistics.timeSeries.byWeek, "weekStart", "commitCount", "#d96c06", "wide")}
            ${chartCard("By Month", "High-level trend across calendar months.", report.statistics.timeSeries.byMonth, "month", "commitCount", "#ab2346", "wide")}
          </div>
        </div>
      </section>`;
}

export function renderRepositoriesTab(report: RunResult): string {
  const repos = [...report.statistics.perRepository]
    .sort((left, right) => right.commitCount - left.commitCount || left.repository.localeCompare(right.repository))
    .slice(0, 12);

  return `<section id="repositories-panel" class="tab-panel">
        <div class="stack stack--wide">
          <div class="panel section">
            <div class="section-header">
              <div>
                <h2 class="section-title">Top Repositories</h2>
                <p class="section-copy">The strongest concentration of commit activity in the selected range.</p>
              </div>
              <div class="chip">${escapeHtml(report.statistics.timeSeries.mostActiveDay?.date ?? "No day data")}</div>
            </div>
            <div class="bar-list">
              ${renderRepoBars(repos)}
            </div>
          </div>

          <div class="panel section">
            <div class="section-header">
              <div>
                <h2 class="section-title">Repository Summary</h2>
                <p class="section-copy">Per-repository rollups with first and last observed authored timestamps.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Commits</th>
                    <th>First</th>
                    <th>Last</th>
                  </tr>
                </thead>
                <tbody>
                  ${report.statistics.perRepository
                    .map(
                      (repo) => `<tr>
                        <td>${escapeHtml(repo.repository)}</td>
                        <td>${formatNumber(repo.commitCount)}</td>
                        <td>${formatDate(repo.firstCommitAt)}</td>
                        <td>${formatDate(repo.lastCommitAt)}</td>
                      </tr>`,
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>`;
}

export function renderIssuesTab(report: RunResult): string {
  return `<section id="issues-panel" class="tab-panel">
        <div class="panel section">
          <div class="section-header">
            <div>
              <h2 class="section-title">Failures And Skips</h2>
              <p class="section-copy">Everything the scan intentionally skipped or could not process.</p>
            </div>
          </div>
          ${renderIssues(report)}
        </div>
      </section>`;
}

export function renderCommitsTab(report: RunResult): string {
  return `<section id="commits-panel" class="tab-panel">
        <div class="panel section">
          <div class="section-header">
            <div>
              <h2 class="section-title">All Commits</h2>
              <p class="section-copy">This full-width explorer renders the complete commit dataset and keeps every row available under filtering.</p>
            </div>
            <div class="header-actions">
              <div class="chip" id="commit-count-chip">${formatNumber(report.data.length)} rows</div>
              <button id="export-csv-button" class="export-button" type="button">Export CSV</button>
            </div>
          </div>
          <div class="filter-row">
            <input id="commit-search" type="search" placeholder="Search repo, branch, scan branch, sha, or message" />
            <select id="repo-filter">
              <option value="">All repositories</option>
            </select>
            <select id="branch-filter">
              <option value="">All branches</option>
            </select>
            <select id="author-filter">
              <option value="">All authors</option>
            </select>
            <select id="wip-filter">
              <option value="">All WIP states</option>
              <option value="true">WIP only</option>
              <option value="false">Non-WIP only</option>
            </select>
            <select id="merge-filter">
              <option value="">All commits</option>
              <option value="true">Merge commits only</option>
              <option value="false">Exclude merge commits</option>
            </select>
            <select id="external-author-filter">
              <option value="">All commits</option>
              <option value="true">External-author merges only</option>
              <option value="false">Exclude external-author merges</option>
            </select>
          </div>
          <div class="column-controls" id="column-controls">
            ${renderColumnToggle("authored", "Authored")}
            ${renderColumnToggle("repository", "Repository")}
            ${renderColumnToggle("branch", "Branch")}
            ${renderColumnToggle("scanBranch", "Scan Branch")}
            ${renderColumnToggle("sha", "SHA")}
            ${renderColumnToggle("message", "Message")}
            ${renderColumnToggle("wip", "WIP")}
            ${renderColumnToggle("merge", "Merge")}
            ${renderColumnToggle("mergeAuthor", "Author")}
          </div>
          <div class="results-meta" id="commit-results-meta"></div>
          <div class="table-wrap table-wrap--commits">
            <table>
              <thead>
                <tr>
                  <th data-column="authored" class="sortable" data-sort-key="authoredDateTime">
                    <span class="sortable-label">Authored <span class="sort-indicator" data-sort-indicator="authoredDateTime">▼</span></span>
                  </th>
                  <th data-column="repository" class="sortable" data-sort-key="repository">
                    <span class="sortable-label">Repository <span class="sort-indicator" data-sort-indicator="repository"></span></span>
                  </th>
                  <th data-column="branch">Branch</th>
                  <th data-column="scanBranch">Scan Branch</th>
                  <th data-column="sha">SHA</th>
                  <th data-column="message">Message</th>
                  <th data-column="wip">WIP</th>
                  <th data-column="merge">Merge</th>
                  <th data-column="mergeAuthor">Author</th>
                </tr>
              </thead>
              <tbody id="commit-table-body"></tbody>
            </table>
          </div>
        </div>
      </section>`;
}

function metricCard(label: string, value: number, hint: string): string {
  return `<div class="panel card">
    <div class="card-label">${escapeHtml(label)}</div>
    <div class="card-value">${formatNumber(value)}</div>
    <div class="card-hint">${escapeHtml(hint)}</div>
  </div>`;
}

function renderColumnToggle(column: string, label: string): string {
  return `<label class="column-toggle">
    <input type="checkbox" data-column-toggle="${escapeHtml(column)}" checked />
    <span>${escapeHtml(label)}</span>
  </label>`;
}

function renderRepoBars(
  repositories: Array<{ repository: string; commitCount: number; defaultBranch: string; firstCommitAt: string; lastCommitAt: string }>,
): string {
  const max = Math.max(...repositories.map((item) => item.commitCount), 1);

  return repositories
    .map((repo) => {
      const width = Math.max((repo.commitCount / max) * 100, 3);
      return `<div class="bar-row">
        <div>
          <div class="bar-label"><strong>${escapeHtml(repo.repository)}</strong><br />${formatDate(repo.firstCommitAt)} to ${formatDate(repo.lastCommitAt)}</div>
          <div class="bar-track"><div class="bar-fill" style="width: ${width}%"></div></div>
        </div>
        <strong>${formatNumber(repo.commitCount)}</strong>
      </div>`;
    })
    .join("");
}

function renderIssues(report: RunResult): string {
  const failures = report.failures;
  const skipped = report.statistics.skippedRepositories;

  if (failures.length === 0 && skipped.length === 0) {
    return `<div class="empty" style="background: rgba(18,116,117,.08); color: #127475;">No failures or skipped repositories were recorded for this run.</div>`;
  }

  return `
    ${failures.length > 0 ? `<div class="table-wrap" style="margin-bottom: 14px;">
      <table>
        <thead>
          <tr>
            <th>Repository</th>
            <th>Stage</th>
            <th>Status</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          ${failures
            .map(
              (failure) => `<tr>
                <td>${escapeHtml(failure.repository)}</td>
                <td>${escapeHtml(failure.stage)}</td>
                <td>${failure.statusCode ?? "-"}</td>
                <td>${escapeHtml(failure.message)}</td>
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>` : ""}
    ${skipped.length > 0 ? `<div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Repository</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          ${skipped
            .map(
              (item) => `<tr>
                <td>${escapeHtml(item.repository)}</td>
                <td>${escapeHtml(item.reason)}</td>
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>` : ""}
  `;
}

function chartCard<T extends object>(
  title: string,
  copy: string,
  points: T[],
  labelKey: keyof T,
  valueKey: keyof T,
  stroke: string,
  size: "default" | "wide" = "default",
): string {
  return `<div class="chart-card ${size === "wide" ? "chart-card--wide" : ""}">
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(copy)}</p>
    ${renderLineChart(points, labelKey, valueKey, stroke, size)}
  </div>`;
}

function renderLineChart<T extends object>(
  points: T[],
  labelKey: keyof T,
  valueKey: keyof T,
  stroke: string,
  size: "default" | "wide" = "default",
): string {
  if (points.length === 0) {
    return `<div class="empty">No data available for this chart.</div>`;
  }

  const width = size === "wide" ? 960 : 340;
  const height = size === "wide" ? 240 : 180;
  const padding = size === "wide" ? 24 : 18;
  const values = points.map((point) => Number(point[valueKey] ?? 0));
  const max = Math.max(...values, 1);
  const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const coordinatesOf = (point: T, index: number): { x: number; y: number } => {
    const x = padding + step * index;
    const y = height - padding - ((Number(point[valueKey] ?? 0) / max) * (height - padding * 2));
    return { x, y };
  };
  const polyline = points
    .map((point, index) => {
      const { x, y } = coordinatesOf(point, index);
      return `${x},${y}`;
    })
    .join(" ");
  const lastLabel = String(points[points.length - 1]?.[labelKey] ?? "");
  const total = values.reduce((sum, value) => sum + value, 0);

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(titleCase(String(labelKey)))} chart">
    <defs>
      <linearGradient id="gradient-${escapeAttribute(String(labelKey))}-${escapeAttribute(stroke)}" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="${stroke}" stop-opacity="0.35"></stop>
        <stop offset="100%" stop-color="${stroke}" stop-opacity="0.02"></stop>
      </linearGradient>
    </defs>
    <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="rgba(20,33,61,0.14)" />
    <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="rgba(20,33,61,0.14)" />
    <polyline fill="none" stroke="${stroke}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" points="${polyline}" />
    ${points
      .map((point, index) => {
        const { x, y } = coordinatesOf(point, index);
        return `<circle cx="${x}" cy="${y}" r="3.8" fill="${stroke}"></circle>`;
      })
      .join("")}
    <text x="${padding}" y="${padding - 4}" fill="#5f6b7a" font-size="11">Peak ${max}</text>
    <text x="${width - padding}" y="${padding - 4}" fill="#5f6b7a" font-size="11" text-anchor="end">${escapeHtml(lastLabel)}</text>
    <text x="${width - padding}" y="${height - padding + 14}" fill="#5f6b7a" font-size="11" text-anchor="end">${formatNumber(total)} total</text>
  </svg>`;
}
